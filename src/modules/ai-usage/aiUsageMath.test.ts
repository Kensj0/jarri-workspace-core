import { durationLabel, exhaustsInMs, windowLabel } from "./aiUsageMath";

const HOUR = 3_600_000;

function expectEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// 20 % använt efter 1 timme av 5 => 80 % kvar vid 20 %/h => 4 timmar kvar.
const meter = { kind: "five_hour", percentUsed: 20, since: 0 };
expectEqual(exhaustsInMs(meter, HOUR), 4 * HOUR, "extrapolation");

// Inget förbrukat, eller ingen starttid, ger inget slutdatum.
expectEqual(exhaustsInMs({ ...meter, percentUsed: 0 }, HOUR), undefined, "nothing used");
expectEqual(
  exhaustsInMs({ kind: "seven_day", percentUsed: 10 }, HOUR),
  undefined,
  "no window start",
);

// Full förbrukning ger noll kvar.
expectEqual(exhaustsInMs({ ...meter, percentUsed: 100 }, HOUR), 0, "fully used");

expectEqual(durationLabel(0), "0 min", "zero duration");
expectEqual(durationLabel(90 * 60_000), "1 h 30 min", "hours and minutes");
expectEqual(windowLabel("seven_day"), "Veckofönstret", "weekly label");
expectEqual(windowLabel("spend_limit"), "spend_limit", "unknown kind passes through");
