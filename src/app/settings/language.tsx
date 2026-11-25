import { Text } from 'react-native';

import { applyLanguage, phoneLocale } from '@/engine/language';
import {
  baseLanguage,
  languageName,
  languagePlan,
  SPEECH_LANGUAGES,
} from '@/engine/language-logic';
import { Page } from '@/features/settings/Page';
import { ChoiceRow, Section, styles } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';

const AUTO = 'auto';

/** Settings › Assistant › Language: what Sidekick listens and answers in. */
export default function LanguageSettings() {
  const { s, set } = useSettings();
  const locale = phoneLocale();
  const phone = baseLanguage(locale);
  const plan = languagePlan(s.speechLanguage ?? AUTO, locale);
  const choose = (v: string | null) => {
    set({ speechLanguage: v ?? AUTO });
    // Settings are saved synchronously; apply right away (downloads the speech model on Wi-Fi).
    setTimeout(applyLanguage, 0);
  };
  return (
    <Page title="Language">
      <Section title="Listening and answers">
        <ChoiceRow<string>
          label="Language"
          hint={`Automatic follows the phone's language (${languageName(phone)}). Now: listening in ${languageName(plan.language)}, answering in ${languageName(plan.answer)}.`}
          options={[
            { value: AUTO, label: 'Automatic' },
            ...SPEECH_LANGUAGES.map((l) => ({ value: l.code, label: l.native })),
          ]}
          value={s.speechLanguage === AUTO ? null : s.speechLanguage}
          recommended={AUTO}
          onChange={choose}
        />
        {plan.unsupported ? <Text style={styles.hint}>{plan.unsupported}</Text> : null}
      </Section>
      <Section title="What changes">
        <Text style={styles.hint}>
          English uses the English speech model. Any other language here downloads the 25-language
          speech model once (0.5 GB, on Wi-Fi) and then deletes the English one. Until it has
          arrived, Sidekick keeps listening in English.
        </Text>
        <Text style={styles.hint}>
          The natural voice speaks English only; other languages use the phone&apos;s own voice.
        </Text>
        <Text style={styles.hint}>
          The wake word stays &quot;Hey Sidekick&quot;. Reminders, times, sums and conversions are
          understood fastest in English; in other languages the AI model works them out, which is
          slower.
        </Text>
        <Text style={styles.hint}>
          Not possible yet: listening in languages outside this list (for example Chinese, Japanese,
          Korean, Arabic, Hindi, Turkish, Norwegian) — the on-phone speech model doesn&apos;t
          understand them. Typed questions can still use them.
        </Text>
      </Section>
    </Page>
  );
}
