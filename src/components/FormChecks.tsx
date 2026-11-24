import { toggleValue } from './Filters';

/** A labelled group of checkboxes (card roles, actions, tags) used by the registration forms. */
export function Checks<T extends string>({ title, choices, values, onChange, disabled }: { title: string; choices: Record<T, string>; values: T[]; onChange: (values: T[]) => void; disabled: boolean }) {
  return <fieldset className="editor-checks" disabled={disabled}><legend>{title}</legend><div>{(Object.entries(choices) as [T, string][]).map(([id, name]) => <label key={id}><input type="checkbox" checked={values.includes(id)} onChange={() => onChange(toggleValue(values, id))} />{name}</label>)}</div></fieldset>;
}
