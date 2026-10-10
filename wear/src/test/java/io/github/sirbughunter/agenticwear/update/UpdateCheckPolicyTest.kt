package io.github.sirbughunter.agenticwear.update

import io.github.sirbughunter.agenticwear.update.UpdateCheckPolicy.shouldCheckOnForeground
import org.junit.Assert.*
import org.junit.Test

class UpdateCheckPolicyTest {
    @Test fun firstForegroundAlwaysChecks() = assertTrue(shouldCheckOnForeground(1_000, null, null))
    @Test fun recentSuccessSkipsForOneMinuteOnly() {
        assertFalse(shouldCheckOnForeground(59_999, lastSuccessMs = 0, lastAttemptMs = 0))
        assertTrue(shouldCheckOnForeground(60_000, lastSuccessMs = 0, lastAttemptMs = 0))
    }
    @Test fun failedCheckDoesNotBlockTheNextForeground() {
        // Last success long ago; a failed attempt 6 s ago must not wait for the old 15-minute window.
        assertTrue(shouldCheckOnForeground(1_006_000, lastSuccessMs = 0, lastAttemptMs = 1_000_000))
    }
    @Test fun rapidWakeSleepIsSpacedOut() =
        assertFalse(shouldCheckOnForeground(1_002_000, lastSuccessMs = null, lastAttemptMs = 1_000_000))
}
