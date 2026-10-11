package io.github.sirbughunter.agenticwear.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateNetworkTest {
    @Test fun grantedInTimeIsUsed() = assertTrue(shouldUseHighBandwidthNetwork(true, 1_200))
    @Test fun notGrantedFallsBack() = assertFalse(shouldUseHighBandwidthNetwork(false, 5_000))
    @Test fun grantedTooLateFallsBack() = assertFalse(shouldUseHighBandwidthNetwork(true, 9_000))
}
