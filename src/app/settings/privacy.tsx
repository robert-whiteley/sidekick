import { AppLockSection } from '@/features/settings/AppLockSection';
import { AutoPauseSection } from '@/features/settings/AutoPauseSection';
import { DataSection } from '@/features/settings/DataSection';
import { DriveBackupSection } from '@/features/settings/DriveBackupSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { OnlineSection } from '@/features/settings/OnlineSection';
import { Page } from '@/features/settings/Page';
import { RetentionSection } from '@/features/settings/RetentionSection';

export default function PrivacySettings() {
  return (
    <Page title="Privacy">
      <AppLockSection />
      <ListeningSection part="privacy" />
      <AutoPauseSection />
      <OnlineSection />
      <RetentionSection onChanged={() => {}} />
      <DataSection onChanged={() => {}} />
      <DriveBackupSection />
    </Page>
  );
}
