// expo-audio needs its native module at import time; tests get a silent player.
const player = { play: () => {}, pause: () => {}, seekTo: async () => {}, remove: () => {} };
export const useAudioPlayer = () => player;
export const useAudioPlayerStatus = () => ({
  playing: false,
  didJustFinish: false,
  currentTime: 0,
  duration: 0,
});
export const createAudioPlayer = () => player;
export const setAudioModeAsync = async () => {};
