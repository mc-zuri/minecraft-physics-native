import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVersion, idMatcher, loadModules } from '../build.ts';
import { legacyBlock } from '../dsl/legacy-blocks.ts';
import { area, at, b, cond, compileScenario, hold, inRange, nameUuid, press, scenario, server, srv, ticks, until, type ScenarioSpec, type StepSpec } from '../dsl/index.ts';

test('every catalog scenario compiles on 1.20.4 with unique ids', async () => {
    const modules = await loadModules();
    const result = buildVersion(modules, '1.20.4');
    assert.ok(result.index.scenarios.length > 1000);
    // a skip is a release gate, something the release lacks, or a migrated case the recorder cannot run yet
    const unexpected = result.index.skipped.filter(s => !/^(outside |no (block|entity|item|effect|attribute|enchantment) |not supported yet: |legacy block id )/.test(s.reason));
    assert.deepEqual(unexpected, []);
    const handWritten = result.index.scenarios.filter(s => !s.id.startsWith('physrec/'));
    assert.ok(handWritten.length > 50 && result.index.skipped.every(s => s.id.startsWith('physrec/') || /^no block mud/.test(s.reason)));
    const ids = result.index.scenarios.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('a lever before the flattening goes by its axis', () => {
    assert.deepEqual(legacyBlock('lever', [['face', 'floor'], ['facing', 'north']], '1.12.2'), { name: 'lever', props: new Map([['facing', 'up_z']]) });
    assert.deepEqual(legacyBlock('lever', [['face', 'floor'], ['facing', 'east']], '1.9.4'), { name: 'lever', props: new Map([['facing', 'up_x']]) });
    assert.deepEqual(legacyBlock('lever', [['face', 'ceiling'], ['facing', 'west']], '1.9.4'), { name: 'lever', props: new Map([['facing', 'down_x']]) });
    assert.deepEqual(legacyBlock('lever', [['face', 'wall'], ['facing', 'south']], '1.9.4'), { name: 'lever', props: new Map([['facing', 'south']]) });
});

test('the fall, gravity and border cases go by the release that has what they are about', async () => {
    const modules = await loadModules();
    const ids = (version: string) => new Set(buildVersion(modules, version).index.scenarios.map(s => s.id));
    const legacy = ids('1.8.8');
    for (const id of ['fd_height_4', 'fd_jump_boost_1_h6', 'fd_on_hay_block_h10', 'jd_ceiling_held', 'bw_static_walk', 'cu_tp_away_and_back']) assert.ok(legacy.has(`physrec/${id}`), id);
    for (const id of ['fd_safe_0_h1', 'jd_power_0_held', 'ps_crawl_scale_2', 'ps_death_tnt_scale_1', 'ng_jump_floats', 'gr_0_air', 'bw_moving_shrink']) assert.ok(!legacy.has(`physrec/${id}`), id);
    assert.ok(ids('1.10.2').has('physrec/ng_jump_floats'));
    assert.ok(ids('1.14.4').has('physrec/ps_death_tnt_scale_1'));
    assert.ok(!ids('1.20.4').has('physrec/gr_0_air'));
    assert.ok(ids('1.20.5').has('physrec/gr_0_air') && ids('1.20.5').has('physrec/fd_safe_0_h1'));
    assert.ok(!ids('1.21.10').has('physrec/bw_moving_shrink'));
    assert.ok(ids('1.21.11').has('physrec/bw_moving_grow'));
    const noGravity = compileScenario(modules.flatMap(m => m.scenarios).find(s => s.id === 'physrec/ng_jump_floats')!, '1.10.2').scenario!;
    assert.deepEqual(noGravity.body.find(s => s.op === 'server'), { op: 'server', action: { op: 'noGravity', noGravity: true } });
});

test('the interaction cases go by the release that has what they are about', async () => {
    const modules = await loadModules();
    const ids = (version: string) => new Set(buildVersion(modules, version).index.scenarios.map(s => s.id));
    const legacy = ids('1.8.8');
    for (const id of ['cw_neg_drift_x', 'lf_level_4', 'fb_idle_air', 'pm_reverse_1', 'hz_cactus_walk_into', 'bo_abs_neg_walk']) assert.ok(legacy.has(`physrec/${id}`), id);
    for (const id of ['wl_toggle_slab', 'fj_water_s0.25_held', 'wv_jump_inside', 'hz_campfire_walk_on', 'et_never_same_team', 'es_slab_under_shulker', 'gl_into_water_45']) assert.ok(!legacy.has(`physrec/${id}`), id);
    const flag = ids('1.20.6');
    assert.ok(flag.has('physrec/fj_water_s0.25_held') && !flag.has('physrec/wv_jump_inside'));
    assert.ok(ids('1.21').has('physrec/wv_jump_inside'));
    assert.ok(ids('1.13.2').has('physrec/wl_toggle_stairs') && !ids('1.13.2').has('physrec/fb_idle_oak_sign'));
    const team = compileScenario(modules.flatMap(m => m.scenarios).find(s => s.id === 'physrec/et_never_same_team')!, '1.10.2').scenario!;
    assert.deepEqual(team.setup.commands.at(-1), 'scoreboard teams join push @e[type=Cow]');
});

test('a case holds to what it is about: its contacts and checks, by release', async () => {
    const all = (await loadModules()).flatMap(m => m.scenarios);
    const compiled = (id: string, version: string) => compileScenario(all.find(s => s.id === `physrec/${id}`)!, version).scenario!;
    const finals = (id: string, version: string) => compiled(id, version).expect.filter(e => e.op === 'final').length;
    const corrections = (id: string, version: string) => compiled(id, version).expect.find(e => e.op === 'corrections') as { allowed: boolean };
    // a check with a release range holds there and only there
    assert.equal(finals('b_climb_walk_up_ladder_water', '1.13.2'), 0);
    assert.equal(finals('b_climb_walk_up_ladder_water', '1.14.4'), 1);
    assert.equal(finals('fc_web_water_sink', '1.20.4'), 1);
    assert.equal(finals('fc_web_water_sink', '26.3'), 2);
    // a correction is allowed where vanilla makes it, and fb_slab_placed has none
    assert.equal(corrections('gl_onto_slime_sneaking', '1.20.4').allowed, false);
    assert.equal(corrections('gl_onto_slime_sneaking', '1.20.5').allowed, true);
    assert.equal(corrections('fb_slab_placed', '26.3').allowed, false);
    // the wet ladder's lane has nothing in front of it, and the current's case starts in the current
    const ladder = compiled('b_climb_walk_up_ladder_water', '26.3').area;
    assert.ok(!ladder.fills.some(f => f.block.startsWith('glass') && f.from[0] === 4));
    assert.equal(compiled('b_flow_idle_drift', '26.3').start.pos[0], -2.5);
});

test('an area has no view distance: the header says what a case ran with', async () => {
    const options = { viewDistance: 8 } as Parameters<typeof area>[1];
    assert.throws(() => area('far', options, () => {}), /no view distance of its own/);
    const result = buildVersion(await loadModules(), '26.3', 'physrec/gr_0_elytra');
    const [scenario] = [...result.modules.values()].flat();
    assert.ok(scenario && !('viewDistance' in scenario.area));
    assert.ok(!('viewDistance' in result.index.scenarios[0]!));
});

test('a release lacking a block skips the scenario with the reason', async () => {
    const result = buildVersion(await loadModules(), '1.16.5', 'surface/mud*');
    assert.deepEqual(result.index.scenarios, []);
    assert.ok(result.index.skipped.every(s => s.reason === 'no block mud'));
});

test('block properties are validated per release', () => {
    const s = scenario('t/slab', {
        area: area('slab', {}, a => a.set([0, -1, 0], b('oak_slab', { type: 'top' }))),
        start: at(0, 0, 0),
        body: [ticks(1)],
    });
    const compiled = compileScenario(s, '1.20.4').scenario!;
    assert.equal(compiled.area.fills[0]!.block, 'oak_slab[type=top]');
    const bad = scenario('t/bad', {
        area: area('bad', {}, a => a.set([0, -1, 0], b('oak_slab', { type: 'sideways' } as never))),
        start: at(0, 0, 0),
        body: [ticks(1)],
    });
    assert.match(compileScenario(bad, '1.20.4').skip!, /no type=sideways/);
});

test('renamed blocks resolve to the release\'s name', () => {
    const s = scenario('t/grass', { area: area('g', {}, a => a.set([0, 0, 0], 'short_grass')), start: at(0, 0, 0), body: [ticks(1)] });
    assert.equal(compileScenario(s, '1.20.4').scenario!.area.fills[0]!.block, 'short_grass');
    assert.equal(compileScenario(s, '1.20.2').scenario!.area.fills[0]!.block, 'grass');
});

test('hashes are stable and change with the content', () => {
    const make = (n: number) => scenario('t/hash', { area: area('h', {}, a => a.floor('stone')), start: at(0, 0, 0), body: [press('forward', n)] });
    const a = compileScenario(make(5), '1.20.4').scenario!;
    assert.equal(a.hash, compileScenario(make(5), '1.20.4').scenario!.hash);
    assert.notEqual(a.hash, compileScenario(make(6), '1.20.4').scenario!.hash);
});

test('version-dependent specs and ranges', () => {
    const s = scenario('t/range', v => ({
        versions: '>=1.19.4',
        area: area('r', {}, a => a.floor(v.atLeast('1.20') ? 'mud' : 'stone')),
        start: at(0, 0, 0),
        body: [hold('forward'), until(cond.onGround(), 5), server(srv.effect('speed', 1))],
    }));
    assert.equal(compileScenario(s, '1.19.2').skip, 'outside >=1.19.4');
    assert.equal(compileScenario(s, '1.20.4').scenario!.area.fills[0]!.block, 'mud');
    assert.ok(inRange('1.20.4', '>=1.20 <1.21'));
    assert.ok(!inRange('1.21', '>=1.20 <1.21'));
});

test('id globs and name UUIDs', () => {
    const m = idMatcher('walk/*,jump/**');
    assert.ok(m('walk/forward_stone'));
    assert.ok(!m('walk/a/b'));
    assert.ok(m('jump/a/b'));
    // java.util.UUID.nameUUIDFromBytes("test".getBytes(UTF_8))
    assert.equal(nameUuid('test'), '098f6bcd-4621-3373-8ade-4e832627b4f6');
});

test('a migrated turn keeps the generator meaning: degrees on each tick', async () => {
    const result = buildVersion(await loadModules(), '1.20.4', 'physrec/j_strafe_circle,physrec/f_elytra_spiral');
    const total = (id: string) => {
        const s = [...result.modules.values()].flat().find(c => c.id === id)!;
        return s.body.filter(st => st.op === 'turn').reduce((n, st) => n + (st as { dyRot: number }).dyRot, 0);
    };
    assert.equal(total('physrec/j_strafe_circle'), -360); // turn(-6, 0, 60)
    assert.equal(total('physrec/f_elytra_spiral'), -1200); // turn(-6, 0, 200)
});

test('a boat needs a wood or raft its release has, not only a boat entity', () => {
    const boatOn = (entity: string, version: string) => compileScenario(scenario('t/boat', {
        area: area('a', {}, () => {}), start: at(0, 0, 0), setup: { summons: [{ ref: 'b', type: entity as 'oak_boat', pos: [0, 0, 0] }], mount: 'b' }, body: [ticks(1)],
    }), version);
    for (const [entity, version] of [['pale_oak_boat', '1.20.4'], ['pale_oak_boat', '1.12.2'], ['pale_oak_boat', '1.8.8'], ['cherry_boat', '1.19.4'], ['cherry_boat', '1.10.2'],
        ['mangrove_boat', '1.18.2'], ['spruce_boat', '1.8.8'], ['bamboo_raft', '1.19.4'], ['bamboo_raft', '1.12.2'], ['bamboo_chest_raft', '1.19.4'], ['oak_chest_boat', '1.18.2'], ['oak_chest_boat', '1.8.8']] as const) {
        assert.equal(boatOn(entity, version).skip, `no entity ${entity}`, `${entity} on ${version}`);
    }
    for (const [entity, version] of [['oak_boat', '1.8.8'], ['spruce_boat', '1.9.4'], ['dark_oak_boat', '1.12.2'], ['spruce_boat', '1.13.2'], ['mangrove_boat', '1.19'], ['oak_chest_boat', '1.19'],
        ['cherry_boat', '1.20'], ['bamboo_raft', '1.20'], ['bamboo_chest_raft', '1.20.4'], ['pale_oak_boat', '1.21.4'], ['oak_boat', '26.3']] as const) {
        const compiled = boatOn(entity, version);
        assert.equal(compiled.skip, undefined, `${entity} on ${version}`);
        assert.equal(compiled.scenario!.setup.summons[0]!.type, entity);
    }
});

test('a case refers only to the summons alive at that step', () => {
    const pig = (ref: string) => ({ ref, type: 'pig' as const, pos: [0, 0, 0] as [number, number, number] });
    const compile = (setup: ScenarioSpec['setup'], ...body: StepSpec[]) =>
        compileScenario(scenario('t/refs', { area: area('a', {}, () => {}), start: at(0, 0, 0), setup, body: [...body, ticks(1)] }), '1.20.4');
    assert.throws(() => compile({ mount: 'p' }, server(srv.summon(pig('p')))), /mount of unknown summon p/);
    assert.throws(() => compile({}, server(srv.mount('p')), server(srv.summon(pig('p')))), /mount of unknown summon p/);
    assert.throws(() => compile({ summons: [pig('p'), pig('p')] }), /summon p twice/);
    assert.throws(() => compile({ summons: [pig('p')] }, server(srv.summon(pig('p')))), /summon p twice/);
    assert.throws(() => compile({ summons: [pig('p')] }, server(srv.remove('p')), server(srv.mount('p'))), /mount of unknown summon p/);
    assert.throws(() => compile({ summons: [pig('p')] }, server(srv.remove('p')), server(srv.remove('p'))), /remove of unknown summon p/);
    assert.throws(() => compile({}, server(srv.velocity([0, 1, 0], 'p'))), /velocity of unknown summon p/);
    // a summon, its use and its removal, and a new summon under the freed name
    const valid = () => compile({ summons: [pig('p')] }, server(srv.mount('p')), server(srv.velocity([0, 1, 0], 'p')), server(srv.remove('p')), server(srv.summon(pig('p'))));
    assert.equal(valid().skip, undefined);
    assert.equal(valid().scenario!.hash, valid().scenario!.hash);
});

test('a release without the block a case is about skips it rather than record an empty lane', async () => {
    const filter = 'physrec/g_step_walk_sculk_sensor,physrec/g_step_walk_pointed_dripstone';
    const old = buildVersion(await loadModules(), '1.16.5', filter);
    assert.deepEqual(old.index.scenarios, []);
    assert.deepEqual(old.index.skipped.map(s => s.reason).sort(), ['no block pointed_dripstone', 'no block sculk_sensor']);
    assert.equal(buildVersion(await loadModules(), '1.20.4', filter).index.scenarios.length, 2);
});
