package io.github.sirbughunter.agenticwear.tile

import android.content.Context
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import io.github.sirbughunter.agenticwear.data.AppPreferences

class RecentSessionsTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        val prefs = AppPreferences(this)
        val sessions = prefs.sessions

        val layout = TileLayoutHelper.buildLayout(
            context = this,
            deviceParameters = requestParams.deviceConfiguration,
            sessions = sessions,
        )

        val timeline = TimelineBuilders.Timeline.fromLayoutElement(layout)

        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(TILE_RESOURCES_VERSION)
            .setTileTimeline(timeline)
            .setFreshnessIntervalMillis(60_000L)
            .build()

        return immediateFuture(tile)
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> {
        val resources = ResourceBuilders.Resources.Builder()
            .setVersion(TILE_RESOURCES_VERSION)
            .build()
        return immediateFuture(resources)
    }

    companion object {
        fun requestUpdate(context: Context) {
            runCatching {
                TileService.getUpdater(context).requestUpdate(RecentSessionsTileService::class.java)
            }
        }
    }
}

private fun <T> immediateFuture(value: T): ListenableFuture<T> =
    CallbackToFutureAdapter.getFuture { completer ->
        completer.set(value)
    }
