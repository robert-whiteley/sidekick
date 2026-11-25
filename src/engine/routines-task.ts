/**
 * The JS side of RoutineTaskService (Android): "SidekickRoutine" runs a routine with or without
 * the app on screen. Registered from the app entry (index.js) so it exists before any screen.
 */
import { AppRegistry } from 'react-native';

import { type RoutinePayload, handleRoutineEvent } from './routines';

export async function routineTask(data: { payload?: string } | undefined): Promise<void> {
  let p: RoutinePayload;
  try {
    p = JSON.parse(data?.payload ?? '{"type":"time"}') as RoutinePayload;
  } catch {
    p = { type: 'time' };
  }
  await handleRoutineEvent(p);
}

AppRegistry.registerHeadlessTask('SidekickRoutine', () => routineTask);
