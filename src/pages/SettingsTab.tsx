import { formatShortcut } from '../components/formatText';
import { AutoTextarea, Field, NumberInput, Toggle } from '../components/ui';
import { ACCENTS } from '../lib/templates';
import type { Lang, Survey, SurveySettings } from '../lib/types';
import type { Updater } from '../lib/useUndoable';

export function SettingsTab({ survey, update }: { survey: Survey; update: Updater<Survey> }) {
  const s = survey.settings;
  const set = <K extends keyof SurveySettings>(key: K, value: SurveySettings[K], coalesce = false) =>
    update((x) => void (x.settings[key] = value), { coalesce: coalesce ? `settings:${key}` : undefined });

  const closeAtLocal = s.closeAt ? toLocalInput(s.closeAt) : '';

  return (
    <div className="page-narrow settings-page" onKeyDownCapture={formatShortcut}>
      <section className="panel">
        <header className="panel-head">
          <h2>General</h2>
        </header>
        <Field label="Survey title" hint="Shown at the top of every page.">
          <input className="input" value={survey.title} onChange={(e) => update((x) => void (x.title = e.target.value), { coalesce: 'title' })} />
        </Field>
        <Field label="Language of buttons and messages" hint="Next, Back, error messages and other built-in text. Your own question text stays as you write it.">
          <select className="input" value={s.language} onChange={(e) => set('language', e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </Field>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Welcome page</h2>
        </header>
        <Toggle label="Show a welcome page" hint="A first page with an introduction and a Start button." checked={s.welcomeEnabled} onChange={(on) => set('welcomeEnabled', on)} />
        {s.welcomeEnabled && (
          <>
            <Field label="Heading">
              <input className="input" value={s.welcomeTitle} placeholder={survey.title} onChange={(e) => set('welcomeTitle', e.target.value, true)} />
            </Field>
            <Field label="Text" hint="Supports **bold**, *italic* and [links](https://…).">
              <AutoTextarea className="input textarea" value={s.welcomeText} onChange={(e) => set('welcomeText', e.target.value, true)} />
            </Field>
          </>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>End page</h2>
        </header>
        <Field label="Heading">
          <input className="input" value={s.endTitle} placeholder={s.language === 'de' ? 'Vielen Dank!' : 'Thank you!'} onChange={(e) => set('endTitle', e.target.value, true)} />
        </Field>
        <Field label="Message" hint="Insert answers with {{variable}} and the response ID with {{response_id}}.">
          <AutoTextarea
            className="input textarea"
            value={s.endMessage}
            placeholder={s.language === 'de' ? 'Ihre Antworten wurden gespeichert.' : 'Your response has been recorded.'}
            onChange={(e) => set('endMessage', e.target.value, true)}
          />
        </Field>
        <Field label="Redirect after finishing" hint="Optional. For example your Prolific completion link. You can add {{PROLIFIC_PID}} or other fields. Only used when the survey ends normally.">
          <input className="input" value={s.redirectUrl} placeholder="https://" onChange={(e) => set('redirectUrl', e.target.value, true)} />
        </Field>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Navigation</h2>
        </header>
        <Toggle label="Progress indicator" checked={s.showProgress} onChange={(on) => set('showProgress', on)} />
        <Toggle label="Back button" hint="Answers on later pages that no longer apply are discarded on submit." checked={s.allowBack} onChange={(on) => set('allowBack', on)} />
        <Toggle label="Number the questions" checked={s.numberQuestions} onChange={(on) => set('numberQuestions', on)} />
        <Toggle label="Remember unfinished answers" hint="Respondents who close the tab can continue later on the same device." checked={s.saveProgress} onChange={(on) => set('saveProgress', on)} />
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Who can respond</h2>
        </header>
        <Toggle
          label="One response per browser"
          hint="Blocks repeat submissions from the same browser. It’s a light check: private windows or another device get around it."
          checked={s.oneResponsePerBrowser}
          onChange={(on) => set('oneResponsePerBrowser', on)}
        />
        <div className="grid-2">
          <Field label="Stop after this many responses" hint="Leave empty for no limit.">
            <NumberInput value={s.responseLimit} placeholder="No limit" onChange={(v) => set('responseLimit', v && v > 0 ? Math.floor(v) : null, true)} />
          </Field>
          <Field label="Close automatically on" hint="Your local time.">
            <input
              className="input"
              type="datetime-local"
              value={closeAtLocal}
              onChange={(e) => set('closeAt', e.target.value ? new Date(e.target.value).toISOString() : null)}
            />
          </Field>
        </div>
        <Field label="Message when closed">
          <AutoTextarea
            className="input textarea"
            value={s.closedMessage}
            placeholder={s.language === 'de' ? 'Diese Umfrage ist geschlossen und nimmt keine Antworten mehr an.' : 'This survey is closed and no longer accepts responses.'}
            onChange={(e) => set('closedMessage', e.target.value, true)}
          />
        </Field>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Appearance</h2>
        </header>
        <fieldset className="swatches">
          <legend className="field-label">Accent colour</legend>
          {ACCENTS.map((a) => (
            <label key={a.value} className={`swatch ${s.accent === a.value ? 'is-on' : ''}`} title={a.name}>
              <input type="radio" name="accent" checked={s.accent === a.value} onChange={() => set('accent', a.value)} />
              <span className="swatch-dot" style={{ background: a.value }} />
              <span className="swatch-name">{a.name}</span>
            </label>
          ))}
          <label className={`swatch ${!ACCENTS.some((a) => a.value === s.accent) ? 'is-on' : ''}`}>
            <input type="color" value={s.accent} onChange={(e) => set('accent', e.target.value, true)} aria-label="Custom colour" />
            <span className="swatch-name">Custom</span>
          </label>
        </fieldset>
        <p className="hint">Used for buttons and selected answers. Pick a dark enough colour so white text on it stays readable.</p>
      </section>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
