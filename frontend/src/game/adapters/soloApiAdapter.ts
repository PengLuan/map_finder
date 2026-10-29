import { api } from '../../api'
import type { GameApiAdapter } from '../base/types'

/** 单人模式 API 适配器 */
export const soloApiAdapter: GameApiAdapter = {
  move: (gameId, direction, distanceKm) => api.move(gameId, direction, distanceKm) as any,
  updateView: (gameId, lng, lat) => api.updateView(gameId, lng, lat) as any,
  checkView: (gameId, west, south, east, north) => api.checkView(gameId, west, south, east, north) as any,
  clickTarget: (gameId, lng, lat) => api.clickTarget(gameId, lng, lat) as any,
  getHint: (gameId, hintLevel) => api.getHint(gameId, hintLevel) as any,
  giveUp: (gameId) => api.giveUp(gameId) as any,
}
