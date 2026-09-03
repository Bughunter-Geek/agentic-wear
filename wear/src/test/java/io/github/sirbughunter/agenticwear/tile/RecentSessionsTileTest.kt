package io.github.sirbughunter.agenticwear.tile

import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.SessionStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class RecentSessionsTileTest {

    @Test
    fun statusDisplayMapsAllSessionStatuses() {
        val baseSession = AgentSession(
            id = "sess-1",
            title = "Test Session",
            updatedAtMillis = 1000L,
            status = SessionStatus.ACTIVE,
            ownedByWear = false,
            canAcceptDirectInput = true,
        )

        val active = TileLayoutHelper.statusDisplay(baseSession.copy(status = SessionStatus.ACTIVE))
        assertEquals("Working", active.first)
        assertEquals(COLOR_CYAN, active.second)

        val idle = TileLayoutHelper.statusDisplay(baseSession.copy(status = SessionStatus.IDLE))
        assertEquals("Ready", idle.first)
        assertEquals(COLOR_FROST, idle.second)

        val error = TileLayoutHelper.statusDisplay(baseSession.copy(status = SessionStatus.ERROR))
        assertEquals("Needs attention", error.first)
        assertEquals(COLOR_CORAL, error.second)

        val notLoaded = TileLayoutHelper.statusDisplay(baseSession.copy(status = SessionStatus.NOT_LOADED))
        assertEquals("Waiting", notLoaded.first)
        assertEquals(COLOR_MUTED, notLoaded.second)
    }

    @Test
    fun sessionTitleFallsBackWhenBlank() {
        val emptySession = AgentSession(
            id = "sess-2",
            title = "   ",
            updatedAtMillis = 1000L,
            status = SessionStatus.IDLE,
            ownedByWear = false,
            canAcceptDirectInput = true,
        )
        assertEquals("Codex session", TileLayoutHelper.sessionTitle(emptySession))

        val normalSession = emptySession.copy(title = "Fix compiler error")
        assertEquals("Fix compiler error", TileLayoutHelper.sessionTitle(normalSession))
    }

    @Test
    fun contentDescriptionCombinesTitleAndStatus() {
        val session = AgentSession(
            id = "sess-3",
            title = "Run migrations",
            updatedAtMillis = 1000L,
            status = SessionStatus.ACTIVE,
            ownedByWear = false,
            canAcceptDirectInput = true,
        )
        assertEquals("Run migrations, Working", TileLayoutHelper.contentDescription(session))
    }

    @Test
    fun maxVisibleSessionsAdaptsToScreenHeightAndFontScale() {
        // Standard Wear OS display (454x454 round or 360x360 square, font scale 1.0)
        assertEquals(2, TileLayoutHelper.maxVisibleSessions(screenHeightDp = 227, fontScale = 1.0f))
        assertEquals(2, TileLayoutHelper.maxVisibleSessions(screenHeightDp = 200, fontScale = 1.0f))

        // Compact height display
        assertEquals(1, TileLayoutHelper.maxVisibleSessions(screenHeightDp = 180, fontScale = 1.0f))

        // Large accessibility font scale
        assertEquals(1, TileLayoutHelper.maxVisibleSessions(screenHeightDp = 227, fontScale = 1.25f))
    }
}
