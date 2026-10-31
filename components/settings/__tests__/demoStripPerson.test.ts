import { demoStripPerson } from "../NotConnectedSection";

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

describe("demoStripPerson", () => {
  it("is the Demo face with the green ring, sorted first, while the demo session is live", () => {
    const onPress = jest.fn();
    const person = demoStripPerson(true, false, onPress);
    expect(person).toMatchObject({ key: "demo", label: "demo", sublabel: "Tomo TV", connected: true, loading: false, lastUsedAt: Number.MAX_SAFE_INTEGER });
    person.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("has no ring and sorts last when another account is signed in", () => {
    const person = demoStripPerson(false, true, jest.fn());
    expect(person.connected).toBe(false);
    expect(person.loading).toBe(true);
    expect(person.lastUsedAt).toBe(0);
  });
});
