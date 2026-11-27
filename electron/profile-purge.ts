import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { profilePurgeSchema, profilePurgeTargetSchema, type ProfilePurgePreview } from '../src/shared/contracts';
import { UserInputError } from './errors';
import { transaction } from './migrations';

type Named = {id:string;name:string};
type DeckRow = Named & {characterId:string;characterName:string};

export class ProfilePurge {
  constructor(private db:DatabaseSync) {}

  private plan(input:unknown) {
    const target=profilePurgeTargetSchema.parse(input);
    const profiles=this.db.prepare(`SELECT p.id,p.name FROM profile_trash t JOIN character_profiles p ON p.id=t.profile_id ORDER BY p.id`).all() as Named[];
    const characters=profiles.filter(profile=>target.kind==='empty'||target.kind==='profile'&&target.id===profile.id);
    const ownerIds=new Set(characters.map(profile=>profile.id));
    const decks=(this.db.prepare(`SELECT d.id,d.name,p.id AS characterId,p.name AS characterName,t.deck_id AS trashed
      FROM decks d JOIN character_profiles p ON p.id=d.character_id LEFT JOIN deck_trash t ON t.deck_id=d.id ORDER BY d.id`).all() as (DeckRow & {trashed:string|null})[])
      .filter(deck=>ownerIds.has(deck.characterId)||deck.trashed&&(target.kind==='empty'||target.kind==='deck'&&deck.id===target.id));
    if (!characters.length&&!decks.length) throw new UserInputError('영구 삭제할 캐릭터 또는 덱이 휴지통에 없습니다.');
    const ids=JSON.stringify(decks.map(deck=>deck.id));
    const owners=JSON.stringify([...ownerIds]);
    const count=(sql:string,parameter:string)=>Number(this.db.prepare(sql).get(parameter)?.total??0);
    const impact={
      characters:characters.map(profile=>profile.name),decks:decks.map(deck=>`${deck.characterName} · ${deck.name}`),
      cards:count('SELECT COUNT(DISTINCT card_id) AS total FROM deck_cards WHERE deck_id IN (SELECT value FROM json_each(?))',ids),
      resources:count('SELECT COUNT(*) AS total FROM resource_instances WHERE character_id IN (SELECT value FROM json_each(?))',owners),
      events:count('SELECT COUNT(*) AS total FROM play_events WHERE character_id IN (SELECT value FROM json_each(?))',owners),
    };
    const quote=createHash('sha256').update(JSON.stringify({ids,owners,impact})).digest('hex');
    return {ids,owners,preview:{...impact,quote}};
  }

  preview(input:unknown):ProfilePurgePreview { return this.plan(input).preview; }

  apply(input:unknown) {
    const {target,quote}=profilePurgeSchema.parse(input);
    transaction(this.db,()=>{
      const plan=this.plan(target);
      if (plan.preview.quote!==quote) throw new UserInputError('삭제 범위가 변경됐습니다. 휴지통에서 다시 확인해 주세요.');
      const deletedDecks='SELECT value FROM json_each(?)';
      const deletedOwners='SELECT value FROM json_each(?)';
      const db=this.db;
      db.prepare(`UPDATE edit_batches SET invalidated_at=? WHERE invalidated_at IS NULL AND
        (json_extract(action_json,'$.characterId') IN (${deletedOwners}) OR
          EXISTS(SELECT 1 FROM json_each(patches_json) AS j WHERE
            json_extract(j.value,'$.key.deck_id') IN (${deletedDecks}) OR
            COALESCE(json_extract(j.value,'$.before.character_id'),json_extract(j.value,'$.after.character_id')) IN (${deletedOwners})))`)
        .run(new Date().toISOString(),plan.owners,plan.ids,plan.owners);
      db.prepare(`UPDATE card_trash SET decks_json=(SELECT json_group_array(json(j.value))
        FROM json_each(card_trash.decks_json) j WHERE json_extract(j.value,'$.id') NOT IN (${deletedDecks}))
        WHERE EXISTS(SELECT 1 FROM json_each(card_trash.decks_json) j WHERE json_extract(j.value,'$.id') IN (${deletedDecks}))`)
        .run(plan.ids,plan.ids);
      db.prepare(`DELETE FROM decks WHERE id IN (${deletedDecks})`).run(plan.ids);
      db.prepare(`DELETE FROM resource_undos WHERE target_event_id IN (SELECT id FROM play_events WHERE character_id IN (${deletedOwners}))
        OR undo_event_id IN (SELECT id FROM play_events WHERE character_id IN (${deletedOwners}))`).run(plan.owners,plan.owners);
      for (const table of ['resource_requests','play_events','card_bindings','character_cost_overrides','resource_revisions']) {
        db.prepare(`DELETE FROM ${table} WHERE character_id IN (${deletedOwners})`).run(plan.owners);
      }
      const privateTemplates=db.prepare(`SELECT m.instance_id AS id FROM card_owned_resources m WHERE character_id IN (${deletedOwners})`).all(plan.owners) as {id:string}[];
      db.prepare(`DELETE FROM card_owned_resources WHERE character_id IN (${deletedOwners})`).run(plan.owners);
      db.prepare(`DELETE FROM resource_instances WHERE character_id IN (${deletedOwners})`).run(plan.owners);
      for (const {id} of privateTemplates) {
        db.prepare("DELETE FROM resource_templates WHERE id=? AND key='card-owned:'||id AND NOT EXISTS(SELECT 1 FROM resource_instances WHERE template_id=?)").run(id,id);
      }
      db.prepare(`DELETE FROM character_profiles WHERE id IN (${deletedOwners})`).run(plan.owners);
      const trimMap=(key:string,ids:string)=>{
        if (ids==='[]') return;
        const data=db.prepare('SELECT value_json FROM settings WHERE key=?').get(key);
        if (!data) return;
        const value=JSON.parse(String(data.value_json));
        for (const id of JSON.parse(ids) as string[]) delete value[id];
        db.prepare('UPDATE settings SET value_json=? WHERE key=?').run(JSON.stringify(value),key);
      };
      for (const key of ['resource_display','history_view','used_view','slot_colors']) trimMap(key,plan.owners);
      const data=db.prepare("SELECT value_json FROM settings WHERE key='appearance'").get();
      if (data && plan.ids!=='[]') {
        const appearance=JSON.parse(String(data.value_json));
        for (const id of JSON.parse(plan.ids) as string[]) if (appearance.cardBack?.decks) delete appearance.cardBack.decks[id];
        db.prepare("UPDATE settings SET value_json=? WHERE key='appearance'").run(JSON.stringify(appearance));
      }
    });
  }
}
