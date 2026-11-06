// bedrock-observer's courses (physics-data-generator catalog/src/observer-areas.json, from bedrock-observer scenarios/worlds/physics/areas.json),
// as builders; maintained here now.
import type { PhysrecArea } from '../../../dsl/physrec.ts'
import { area, fill } from './_build.ts'

export const flat: PhysrecArea = area('flat', [-30, 30, -30, 30], [
  fill([-30, 0, -30], [30, 0, 30], 'stone'),
])

export const collisionWalls: PhysrecArea = area('collisionWalls', [-15, 15, -15, 15], [
  fill([-15, 0, -15], [15, 0, 15], 'stone'),
  fill([0, 1, 5], [0, 3, 10], 'stone'),
  fill([-10, 1, 0], [-5, 3, 0], 'stone'),
  fill([5, 1, -10], [10, 3, -10], 'stone'),
  fill([10, 1, -10], [10, 3, -5], 'stone'),
  fill([-10, 1, 10], [-5, 2, 10], 'stone'),
  fill([-15, 1, -5], [-13, 3, -5], 'stone'),
  fill([-11, 1, -5], [-9, 3, -5], 'stone'),
])

export const sneakEdgePlatform: PhysrecArea = area('sneakEdgePlatform', [-7, 7, -7, 7], [
  fill([-7, 0, -7], [7, 0, 7], 'stone'),
  fill([-5, 5, -5], [5, 5, 5], 'stone'),
  fill([0, 1, -5], [0, 5, -5], 'stone'),
  fill([0, 1, -6], [0, 5, -6], 'ladder[facing=north]'),
])

export const slabArea: PhysrecArea = area('slabArea', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [10, 0, 10], 'stone'),
  fill([-8, 1, -5], [8, 1, -5], 'stone_slab[type=bottom]'),
  fill([-8, 1, -3], [8, 1, -3], 'stone_slab[type=bottom]'),
  fill([-4, 1, 0], [3, 1, 0], 'stone_slab[type=bottom]'),
  fill([-5, 2, 3], [-5, 2, 3], 'stone_slab[type=bottom]'),
  fill([-3, 3, 3], [-3, 3, 3], 'stone_slab[type=bottom]'),
  fill([-1, 4, 3], [-1, 4, 3], 'stone_slab[type=bottom]'),
  fill([3, 1, 3], [3, 1, 3], 'stone'),
  fill([4, 1, 3], [4, 1, 3], 'stone_slab[type=bottom]'),
  fill([5, 1, 3], [5, 1, 3], 'stone'),
])

export const stairsArea: PhysrecArea = area('stairsArea', [-15, 15, -15, 15], [
  fill([-15, 0, -15], [15, 0, 15], 'stone'),
  fill([-10, 1, -10], [-10, 1, -10], 'stone_stairs[facing=east]'),
  fill([-9, 2, -10], [-9, 2, -10], 'stone_stairs[facing=east]'),
  fill([-8, 3, -10], [-8, 3, -10], 'stone_stairs[facing=east]'),
  fill([-7, 4, -10], [-7, 4, -10], 'stone_stairs[facing=east]'),
  fill([-6, 5, -10], [-6, 5, -10], 'stone_stairs[facing=east]'),
  fill([10, 1, -10], [10, 1, -10], 'stone_stairs[facing=west]'),
  fill([9, 2, -10], [9, 2, -10], 'stone_stairs[facing=west]'),
  fill([8, 3, -10], [8, 3, -10], 'stone_stairs[facing=west]'),
  fill([7, 4, -10], [7, 4, -10], 'stone_stairs[facing=west]'),
  fill([6, 5, -10], [6, 5, -10], 'stone_stairs[facing=west]'),
  fill([-10, 1, -5], [-10, 1, -5], 'stone_stairs[facing=south]'),
  fill([-10, 2, -4], [-10, 2, -4], 'stone_stairs[facing=south]'),
  fill([-10, 3, -3], [-10, 3, -3], 'stone_stairs[facing=south]'),
  fill([-10, 4, -2], [-10, 4, -2], 'stone_stairs[facing=south]'),
  fill([-10, 5, -1], [-10, 5, -1], 'stone_stairs[facing=south]'),
  fill([-10, 1, 10], [-10, 1, 10], 'stone_stairs[facing=north]'),
  fill([-10, 2, 9], [-10, 2, 9], 'stone_stairs[facing=north]'),
  fill([-10, 3, 8], [-10, 3, 8], 'stone_stairs[facing=north]'),
  fill([-10, 4, 7], [-10, 4, 7], 'stone_stairs[facing=north]'),
  fill([-10, 5, 6], [-10, 5, 6], 'stone_stairs[facing=north]'),
  fill([0, 1, 0], [0, 1, 0], 'stone_stairs[facing=south]'),
  fill([0, 1, 0], [0, 1, 0], 'stone_stairs[facing=south]'),
  fill([1, 2, 0], [1, 2, 0], 'stone_stairs[facing=east]'),
  fill([0, 2, 1], [0, 2, 1], 'stone_stairs[facing=south]'),
  fill([2, 3, 0], [2, 3, 0], 'stone_stairs[facing=east]'),
  fill([0, 3, 2], [0, 3, 2], 'stone_stairs[facing=south]'),
  fill([5, 1, 5], [5, 1, 5], 'stone_stairs[facing=east]'),
  fill([6, 2, 5], [6, 2, 5], 'stone_stairs[facing=east]'),
  fill([7, 3, 5], [7, 3, 5], 'stone_stairs[facing=east]'),
  fill([8, 4, 5], [8, 4, 5], 'stone_stairs[facing=east]'),
  fill([9, 5, 5], [9, 5, 5], 'stone_stairs[facing=east]'),
  fill([5, 1, -5], [7, 1, -3], 'stone'),
])

export const ceilingRoom: PhysrecArea = area('ceilingRoom', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [10, 0, 10], 'stone'),
  fill([-10, 3, -10], [-1, 3, -1], 'stone'),
  fill([-10, 1, -10], [-10, 3, -1], 'stone'),
  fill([-1, 1, -10], [-1, 3, -1], 'stone'),
  fill([-10, 1, -10], [-1, 3, -10], 'stone'),
  fill([1, 2, -10], [10, 2, -1], 'stone'),
  fill([1, 1, -10], [1, 2, -1], 'stone'),
  fill([10, 1, -10], [10, 2, -1], 'stone'),
  fill([1, 1, -10], [10, 2, -10], 'stone'),
  fill([-5, 1, 3], [5, 1, 7], 'stone'),
  fill([-5, 1, 3], [-5, 1, 7], 'stone'),
  fill([5, 1, 3], [5, 1, 7], 'stone'),
  fill([-5, 1, 7], [5, 1, 7], 'stone'),
])

export const iceSurface: PhysrecArea = area('iceSurface', [-20, 20, -10, 10], [
  fill([-20, 0, -10], [20, 0, 10], 'stone'),
  fill([-19, 0, -9], [19, 0, 9], 'ice'),
])

export const packedIceSurface: PhysrecArea = area('packedIceSurface', [-20, 20, -10, 10], [
  fill([-20, 0, -10], [20, 0, 10], 'stone'),
  fill([-19, 0, -9], [19, 0, 9], 'packed_ice'),
])

export const blueIceSurface: PhysrecArea = area('blueIceSurface', [-20, 20, -10, 10], [
  fill([-20, 0, -10], [20, 0, 10], 'stone'),
  fill([-19, 0, -9], [19, 0, 9], 'blue_ice'),
])

export const honeySurface: PhysrecArea = area('honeySurface', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [10, 0, 10], 'stone'),
  fill([-9, 0, -9], [9, 0, 9], 'honey_block'),
])

export const slimeSurface: PhysrecArea = area('slimeSurface', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [10, 0, 10], 'slime_block'),
  fill([3, 0, -5], [4, 1, -4], 'stone'),
  fill([3, 1, -5], [4, 1, -3], 'stone'),
  fill([5, 0, -5], [6, 3, -4], 'stone'),
  fill([5, 3, -5], [6, 3, -3], 'stone'),
  fill([7, 0, -5], [8, 5, -4], 'stone'),
  fill([7, 5, -5], [8, 5, -3], 'stone'),
  fill([9, 0, -5], [10, 10, -4], 'stone'),
  fill([9, 10, -5], [10, 10, -3], 'stone'),
  fill([-3, 0, -5], [-2, 20, -4], 'stone'),
  fill([-3, 20, -5], [-2, 20, -3], 'stone'),
])

export const soulSandSurface: PhysrecArea = area('soulSandSurface', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [10, 0, 10], 'stone'),
  fill([-9, 0, -9], [9, 0, 9], 'soul_sand'),
])

export const soulSoilSurface: PhysrecArea = area('soulSoilSurface', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [10, 0, 10], 'stone'),
  fill([-9, 0, -9], [9, 0, 9], 'soul_soil'),
])

export const ladderWall: PhysrecArea = area('ladderWall', [-5, 5, -5, 5], [
  fill([-5, 0, -5], [5, 0, 5], 'stone'),
  fill([-5, 1, 5], [5, 10, 5], 'stone'),
  fill([-5, 1, 4], [-5, 10, 4], 'ladder[facing=north]'),
  fill([-4, 1, 4], [-4, 10, 4], 'ladder[facing=north]'),
  fill([-3, 1, 4], [-3, 10, 4], 'ladder[facing=north]'),
  fill([-2, 1, 4], [-2, 10, 4], 'ladder[facing=north]'),
  fill([-1, 1, 4], [-1, 10, 4], 'ladder[facing=north]'),
  fill([0, 1, 4], [0, 10, 4], 'ladder[facing=north]'),
  fill([1, 1, 4], [1, 10, 4], 'ladder[facing=north]'),
  fill([2, 1, 4], [2, 10, 4], 'ladder[facing=north]'),
  fill([3, 1, 4], [3, 10, 4], 'ladder[facing=north]'),
  fill([4, 1, 4], [4, 10, 4], 'ladder[facing=north]'),
  fill([5, 1, 4], [5, 10, 4], 'ladder[facing=north]'),
])

export const scaffoldingTower: PhysrecArea = area('scaffoldingTower', [-5, 5, -5, 5], [
  fill([-5, 0, -5], [5, 0, 5], 'stone'),
  fill([-1, 1, -1], [1, 10, 1], 'scaffolding'),
  fill([-2, 11, -2], [2, 11, 2], 'stone'),
])

export const vineWall: PhysrecArea = area('vineWall', [-10, 10, -10, 10], [
  fill([-5, 0, -10], [5, 0, 10], 'stone'),
  fill([-10, 1, 5], [10, 10, 5], 'stone'),
  fill([-10, 1, 4], [-10, 10, 4], 'vine[south=true]'),
  fill([-9, 1, 4], [-9, 10, 4], 'vine[south=true]'),
  fill([-8, 1, 4], [-8, 10, 4], 'vine[south=true]'),
  fill([-7, 1, 4], [-7, 10, 4], 'vine[south=true]'),
  fill([-6, 1, 4], [-6, 10, 4], 'vine[south=true]'),
  fill([-5, 1, 4], [-5, 10, 4], 'vine[south=true]'),
  fill([-4, 1, 4], [-4, 10, 4], 'vine[south=true]'),
  fill([-3, 10, 3], [3, 10, 3], 'stone'),
  fill([-3, 3, 3], [3, 9, 3], 'cave_vines', { since: '1.17' }),
  fill([4, 1, 3], [10, 8, 3], 'twisting_vines', { since: '1.16' }),
])

export const waterPool: PhysrecArea = area('waterPool', [-15, 15, -12, 10], [
  fill([-15, -10, -10], [15, -10, 10], 'stone'),
  fill([-15, -10, -10], [-15, 0, 10], 'stone'),
  fill([15, -10, -10], [15, 0, 10], 'stone'),
  fill([-15, -10, -10], [15, 0, -10], 'stone'),
  fill([-15, -10, 10], [15, 0, 10], 'stone'),
  fill([-14, -9, -9], [14, 0, 9], 'water'),
])

export const lavaPool: PhysrecArea = area('lavaPool', [-15, 15, -12, 10], [
  fill([-15, -10, -10], [15, -10, 10], 'stone'),
  fill([-15, -10, -10], [-15, 0, 10], 'stone'),
  fill([15, -10, -10], [15, 0, 10], 'stone'),
  fill([-15, -10, -10], [15, 0, -10], 'stone'),
  fill([-15, -10, 10], [15, 0, 10], 'stone'),
  fill([-14, -9, -9], [14, 0, 9], 'lava'),
])

export const cobwebField: PhysrecArea = area('cobwebField', [-5, 5, -8, 5], [
  fill([-5, 0, -5], [5, 0, 5], 'stone'),
  fill([-5, 0, -8], [5, 0, -6], 'stone'),
  fill([-5, 1, -5], [5, 5, 5], 'cobweb'),
])

export const berryBushField: PhysrecArea = area('berryBushField', [-5, 5, -8, 5], [
  fill([-5, 0, -5], [5, 0, 5], 'dirt'),
  fill([-5, 0, -8], [5, 0, -6], 'stone'),
  fill([-5, 1, -5], [5, 1, 5], 'sweet_berry_bush'),
])

export const powderSnowField: PhysrecArea = area('powderSnowField', [-5, 5, -8, 5], [
  fill([-5, -5, -5], [5, -5, 5], 'stone'),
  fill([-5, 0, -8], [5, 0, -6], 'stone'),
  fill([-5, -4, -5], [5, 5, 5], 'powder_snow', { since: '1.17' }),
])

export const bubbleUpColumn: PhysrecArea = area('bubbleUpColumn', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [0, 0, 10], 'stone'),
  fill([0, -8, -10], [10, -8, 10], 'stone'),
  fill([0, -8, -10], [10, 0, -10], 'stone'),
  fill([0, -8, 10], [10, 0, 10], 'stone'),
  fill([10, -8, -10], [10, 0, 10], 'stone'),
  fill([1, -8, -9], [9, -8, 9], 'soul_sand'),
  fill([1, -7, -9], [9, 0, 9], 'bubble_column[drag=false]'),
])

export const bubbleDownColumn: PhysrecArea = area('bubbleDownColumn', [-10, 10, -10, 10], [
  fill([-10, 0, -10], [0, 0, 10], 'stone'),
  fill([0, -8, -10], [10, -8, 10], 'stone'),
  fill([0, -8, -10], [10, 0, -10], 'stone'),
  fill([0, -8, 10], [10, 0, 10], 'stone'),
  fill([10, -8, -10], [10, 0, 10], 'stone'),
  fill([1, -8, -9], [9, -8, 9], 'magma_block'),
  fill([1, -7, -9], [9, 0, 9], 'bubble_column[drag=true]'),
])

export const fenceArea: PhysrecArea = area('fenceArea', [-15, 15, -15, 15], [
  fill([-15, 0, -15], [15, 0, 15], 'stone'),
  fill([-12, 1, -12], [-12, 1, -12], 'oak_fence', { update: true }),
  fill([-12, 1, -10], [-12, 1, -8], 'oak_fence', { update: true }),
  fill([-10, 1, -12], [-8, 1, -12], 'oak_fence', { update: true }),
  fill([-6, 1, -12], [-5, 1, -12], 'oak_fence', { update: true }),
  fill([-6, 1, -11], [-6, 1, -11], 'oak_fence', { update: true }),
  fill([-3, 1, -12], [-1, 1, -12], 'oak_fence', { update: true }),
  fill([-2, 1, -11], [-2, 1, -11], 'oak_fence', { update: true }),
  fill([2, 1, -12], [2, 1, -12], 'oak_fence', { update: true }),
  fill([1, 1, -12], [1, 1, -12], 'oak_fence', { update: true }),
  fill([3, 1, -12], [3, 1, -12], 'oak_fence', { update: true }),
  fill([2, 1, -11], [2, 1, -11], 'oak_fence', { update: true }),
  fill([2, 1, -13], [2, 1, -13], 'oak_fence', { update: true }),
  fill([-12, 1, -5], [-12, 1, -5], 'glass_pane', { update: true }),
  fill([-12, 1, -3], [-12, 1, -1], 'glass_pane', { update: true }),
  fill([-10, 1, -5], [-8, 1, -5], 'glass_pane', { update: true }),
  fill([-6, 1, -5], [-5, 1, -5], 'glass_pane', { update: true }),
  fill([-6, 1, -4], [-6, 1, -4], 'glass_pane', { update: true }),
  fill([-3, 1, -5], [-1, 1, -5], 'glass_pane', { update: true }),
  fill([-2, 1, -4], [-2, 1, -4], 'glass_pane', { update: true }),
  fill([2, 1, -5], [2, 1, -5], 'glass_pane', { update: true }),
  fill([1, 1, -5], [1, 1, -5], 'glass_pane', { update: true }),
  fill([3, 1, -5], [3, 1, -5], 'glass_pane', { update: true }),
  fill([2, 1, -4], [2, 1, -4], 'glass_pane', { update: true }),
  fill([2, 1, -6], [2, 1, -6], 'glass_pane', { update: true }),
  fill([-12, 1, 2], [-12, 1, 2], 'iron_bars', { update: true }),
  fill([-12, 1, 4], [-12, 1, 6], 'iron_bars', { update: true }),
  fill([-10, 1, 2], [-8, 1, 2], 'iron_bars', { update: true }),
  fill([-6, 1, 2], [-5, 1, 2], 'iron_bars', { update: true }),
  fill([-6, 1, 3], [-6, 1, 3], 'iron_bars', { update: true }),
  fill([-3, 1, 2], [-1, 1, 2], 'iron_bars', { update: true }),
  fill([-2, 1, 3], [-2, 1, 3], 'iron_bars', { update: true }),
  fill([2, 1, 2], [2, 1, 2], 'iron_bars', { update: true }),
  fill([1, 1, 2], [1, 1, 2], 'iron_bars', { update: true }),
  fill([3, 1, 2], [3, 1, 2], 'iron_bars', { update: true }),
  fill([2, 1, 3], [2, 1, 3], 'iron_bars', { update: true }),
  fill([2, 1, 1], [2, 1, 1], 'iron_bars', { update: true }),
  fill([8, 1, -12], [8, 3, -12], 'stone'),
  fill([7, 1, -12], [7, 1, -12], 'oak_fence', { update: true }),
  fill([9, 1, -12], [9, 1, -12], 'oak_fence', { update: true }),
])

export const flatPit: PhysrecArea = area('flatPit', [-15, 15, -15, 15], [
  fill([-15, 0, -15], [15, 0, 15], 'stone'),
  fill([-1, -4, -15], [0, 0, 15], 'air'),
  fill([-1, -5, -15], [0, -5, 15], 'stone'),
  fill([5, -4, -15], [5, 0, 15], 'air'),
  fill([5, -5, -15], [5, -5, 15], 'stone'),
])

export default [flat, collisionWalls, sneakEdgePlatform, slabArea, stairsArea, ceilingRoom, iceSurface, packedIceSurface, blueIceSurface, honeySurface, slimeSurface, soulSandSurface, soulSoilSurface, ladderWall, scaffoldingTower, vineWall, waterPool, lavaPool, cobwebField, berryBushField, powderSnowField, bubbleUpColumn, bubbleDownColumn, fenceArea, flatPit]
