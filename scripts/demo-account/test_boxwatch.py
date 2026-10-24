"""boxwatch.py's decisions on synthetic samples: python3 -m unittest discover -s scripts/demo-account -p test_boxwatch.py"""

import unittest

import boxwatch

T0 = 1_792_836_000  # 2026-10-24 10:00 UTC
INTERVAL = 300


def sample(at=T0, cpu_busy=1_000, cpu_total=10_000, tx=1_000_000_000, mem_gb=10.0, disk_gb=11.0, plays=1, up=True):
    return {
        "at": at,
        "cpu_busy": cpu_busy,
        "cpu_total": cpu_total,
        "load": ["0.1", "0.1", "0.1"],
        "mem_available_gb": mem_gb,
        "iface": "enp0s6",
        "tx_bytes": tx,
        "disk_free_gb": disk_gb,
        "disk_used_pct": 77.0,
        "jellyfin_up": up,
        "plays": plays if up else None,
        "clients": plays if up else None,
        "transcodes": 0 if up else None,
    }


class Measure(unittest.TestCase):
    def test_first_run_has_no_rates_and_starts_the_month_at_zero(self):
        m = boxwatch.measure(sample(), {})
        self.assertIsNone(m["cpu_pct"])
        self.assertIsNone(m["egress_mbps"])
        self.assertEqual((m["month"], m["month_bytes"]), ("2026-10", 0))

    def test_rates_come_from_the_deltas_over_the_interval(self):
        _, _, state, _, _ = boxwatch.evaluate(sample(), {}, T0)
        later = sample(at=T0 + INTERVAL, cpu_busy=1_000 + 1_800, cpu_total=10_000 + 2_000, tx=1_000_000_000 + 375_000_000)
        m = boxwatch.measure(later, state)
        self.assertAlmostEqual(m["cpu_pct"], 90.0)
        self.assertAlmostEqual(m["egress_mbps"], 10.0)
        self.assertEqual(m["month_bytes"], 375_000_000)

    def test_a_transmit_counter_below_the_last_reading_counts_its_new_value(self):
        _, _, state, _, _ = boxwatch.evaluate(sample(tx=5_000_000_000), {}, T0)
        m = boxwatch.measure(sample(at=T0 + INTERVAL, tx=40_000_000), state)
        self.assertEqual(m["month_bytes"], 40_000_000)
        self.assertAlmostEqual(m["egress_mbps"], 40_000_000 * 8 / INTERVAL / 1e6)

    def test_a_new_month_starts_the_sum_again(self):
        state = {"last": {"at": T0, "cpu_busy": 1_000, "cpu_total": 10_000, "tx_bytes": 1_000_000_000}, "month": "2026-10", "month_bytes": 7_000_000_000_000}
        november = 1_793_536_000  # 2026-11-01 12:26 UTC
        m = boxwatch.measure(sample(at=november, tx=1_000_000_000 + 1_000), state)
        self.assertEqual((m["month"], m["month_bytes"]), ("2026-11", 1_000))


class Evaluate(unittest.TestCase):
    def test_a_quiet_box_pushes_nothing(self):
        alerts, recovered, state, _, levels = boxwatch.evaluate(sample(), {}, T0)
        self.assertEqual((alerts, recovered), ([], []))
        self.assertTrue(all(lvl is None for lvl in levels.values()))
        self.assertEqual(state["alerted"], {})
        self.assertEqual(state["month_started"], "2026-10")

    def test_a_condition_pushes_when_it_first_appears_and_stays_quiet_while_it_holds(self):
        alerts, _, state, _, _ = boxwatch.evaluate(sample(disk_gb=6.0), {}, T0)
        self.assertEqual(alerts, [("disk", "default")])
        alerts, recovered, state, _, _ = boxwatch.evaluate(sample(at=T0 + INTERVAL, disk_gb=5.5), state, T0 + INTERVAL)
        self.assertEqual((alerts, recovered), ([], []))
        self.assertEqual(state["alerted"]["disk"]["at"], T0)

    def test_a_held_condition_pushes_again_after_six_hours(self):
        _, _, state, _, _ = boxwatch.evaluate(sample(disk_gb=6.0), {}, T0)
        later = T0 + boxwatch.REPEAT_S
        alerts, _, state, _, _ = boxwatch.evaluate(sample(at=later, disk_gb=6.0), state, later)
        self.assertEqual(alerts, [("disk", "default")])
        self.assertEqual(state["alerted"]["disk"]["at"], later)

    def test_rising_to_high_pushes_at_once_and_falling_back_does_not(self):
        _, _, state, _, _ = boxwatch.evaluate(sample(disk_gb=6.0), {}, T0)
        alerts, _, state, _, _ = boxwatch.evaluate(sample(at=T0 + INTERVAL, disk_gb=3.0), state, T0 + INTERVAL)
        self.assertEqual(alerts, [("disk", "high")])
        alerts, recovered, _, _, _ = boxwatch.evaluate(sample(at=T0 + 2 * INTERVAL, disk_gb=6.0), state, T0 + 2 * INTERVAL)
        self.assertEqual((alerts, recovered), ([], []))

    def test_a_cleared_condition_pushes_recovered_once(self):
        _, _, state, _, _ = boxwatch.evaluate(sample(disk_gb=6.0), {}, T0)
        alerts, recovered, state, _, _ = boxwatch.evaluate(sample(at=T0 + INTERVAL, disk_gb=12.0), state, T0 + INTERVAL)
        self.assertEqual((alerts, recovered), ([], ["disk"]))
        alerts, recovered, _, _, _ = boxwatch.evaluate(sample(at=T0 + 2 * INTERVAL, disk_gb=12.0), state, T0 + 2 * INTERVAL)
        self.assertEqual((alerts, recovered), ([], []))

    def test_jellyfin_down_is_high_and_the_play_count_says_nothing(self):
        alerts, _, _, _, levels = boxwatch.evaluate(sample(up=False), {}, T0)
        self.assertEqual(alerts, [("jellyfin", "high")])
        self.assertIsNone(levels["plays"])

    def test_cpu_and_egress_over_the_interval_are_rated(self):
        _, _, state, _, _ = boxwatch.evaluate(sample(), {}, T0)
        hammered = sample(at=T0 + INTERVAL, cpu_busy=1_000 + 1_950, cpu_total=10_000 + 2_000, tx=1_000_000_000 + 450 * INTERVAL * 1e6 / 8)
        alerts, _, _, _, _ = boxwatch.evaluate(hammered, state, T0 + INTERVAL)
        self.assertEqual(sorted(alerts), [("cpu", "high"), ("egress", "high")])

    def test_many_viewers_is_rated_by_count(self):
        self.assertEqual(boxwatch.evaluate(sample(plays=15), {}, T0)[0], [("plays", "default")])
        self.assertEqual(boxwatch.evaluate(sample(plays=40), {}, T0)[0], [("plays", "high")])
        self.assertEqual(boxwatch.evaluate(sample(plays=14), {}, T0)[0], [])


class Report(unittest.TestCase):
    def test_the_report_names_the_active_conditions_and_the_folders(self):
        s = sample(disk_gb=3.0)
        _, _, state, m, levels = boxwatch.evaluate(s, {}, T0)
        text = boxwatch.report_text(s, m, levels, state["month_started"], [(19_000_000_000, "/opt/tomotv/media")])
        self.assertIn("disk 3.0 GB free (77% used)", text)
        self.assertIn("19.0 GB  /opt/tomotv/media", text)
        self.assertIn("conditions: disk low (high)", text)
        self.assertIn("cpu n/a (first run)", text)


if __name__ == "__main__":
    unittest.main()
