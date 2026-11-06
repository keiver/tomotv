/** A press-and-hold has no VoiceOver or Voice Control gesture, so the element also offers it by name. */
export function namedAction(name: string, label: string, run: () => void) {
  return {
    accessibilityActions: [{ name, label }],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === name) run();
    },
  };
}
