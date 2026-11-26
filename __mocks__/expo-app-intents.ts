// expo-app-intents is iOS-only native code; tests see it as unavailable (as on Android).
export const isAvailable = () => false;
export const useAppIntents = () => {};
export const removePendingInvocationAsync = async () => {};
export const addAppIntentListener = () => ({ remove: () => {} });
