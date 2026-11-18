import type { CardDefinition, Deck, ProfileSummary } from '../shared/contracts';

/**
 * v1.2: deck building from the whole library. With no character selected the selected card can be
 * put into (or taken out of) any character's deck. Only deck membership changes, never the card.
 */
export function DeckMembership({ card, decks, profiles, busy, onToggle }: { card: CardDefinition; decks: Deck[]; profiles: ProfileSummary[]; busy: boolean; onToggle: (deck: Deck) => void }) {
  if (!decks.length) return <p className="muted">아직 덱이 없습니다. 캐릭터·덱에서 캐릭터를 만들면 기본 덱이 생깁니다.</p>;
  return <fieldset className="deck-membership"><legend>덱에 넣기·빼기</legend>
    <ul>{decks.map(deck => {
      const owner = profiles.find(profile => profile.id === deck.characterId)?.name ?? '캐릭터';
      const member = deck.cardIds.includes(card.id);
      return <li key={deck.id} className={member ? 'is-member' : undefined}>
        <span className="deck-membership-name">{owner} · {deck.name}{member && <span className="deck-membership-mark"> ✓ 들어 있음</span>}</span>
        <button type="button" disabled={busy} aria-label={`${owner} · ${deck.name}${member ? '에서 빼기' : '에 넣기'}`} onClick={() => onToggle(deck)}>{member ? '빼기' : '넣기'}</button>
      </li>;
    })}</ul>
    <p className="muted">카드 정의·이미지·비용은 바뀌지 않고 덱 구성만 바뀝니다. 캐릭터를 고르면 그 캐릭터의 활성 덱이 손패에 표시됩니다.</p>
  </fieldset>;
}
