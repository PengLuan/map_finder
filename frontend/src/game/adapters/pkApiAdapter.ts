import { pkApi } from '../../api/pk'
import type { GameApiAdapter } from '../base/types'

/** PK 模式 API 适配器 */
export const pkApiAdapter: GameApiAdapter = {
  move: (gameId, direction, distanceKm) => pkApi.move(gameId, direction, distanceKm) as any,
  updateView: (gameId, lng, lat) => pkApi.updateView(gameId, lng, lat) as any,
  checkView: (gameId, west, south, east, north) => pkApi.checkView(gameId, west, south, east, north) as any,
  clickTarget: (gameId, lng, lat) => pkApi.clickTarget(gameId, lng, lat) as any,
  getHint: (gameId, hintLevel) => pkApi.useHint(gameId, hintLevel) as any,
  giveUp: (gameId) => pkApi.giveUp(gameId) as any,
}
