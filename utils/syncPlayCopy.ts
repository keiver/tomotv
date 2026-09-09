const STATE_LABEL: Record<string, string> = { Idle: "Idle", Waiting: "Waiting", Playing: "Playing", Paused: "Paused" };

/** The group's state as the screens name it. */
export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

/**
 * "admin, demo and pat are connected, playback is paused". Names come from the server, which
 * lists distinct accounts rather than devices, so this counts people and not screens.
 */
export function connectedLine(participants: string[], state: string): string {
  const status = `playback is ${stateLabel(state).toLowerCase()}`;
  if (participants.length === 0) return `Nobody is connected yet, ${status}`;
  if (participants.length === 1) return `${participants[0]} is connected, ${status}`;
  const names = `${participants.slice(0, -1).join(", ")} and ${participants[participants.length - 1]}`;
  return `${names} are connected, ${status}`;
}
