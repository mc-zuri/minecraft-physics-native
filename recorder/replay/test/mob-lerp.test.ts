// A mob the server drives, as its rider's client keeps it (mob-lerp.ts): the move packets start a 3-step interpolation to
// where the client keeps the server's position, and nothing else moves it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServerDrivenMobs } from '../mob-lerp.ts';
import { codecsFor } from '../packets.ts';

const ID = 7;
const move = (version: string, dY: number) => {
    const bytes = codecsFor(version).toClient.createPacketBuffer({ name: 'rel_entity_move', params: { entityId: ID, dX: 0, dY, dZ: 0, onGround: false } });
    return { name: 'Pos', b: Buffer.from(bytes).toString('base64') };
};

describe('a mob the server drives', () => {
    it('stays where it is with no packet of its own', () => {
        const mobs = new ServerDrivenMobs('1.20.4');
        const at = { x: 0.5, y: 100, z: 0.5 };
        assert.equal(mobs.packets({ s2c: [] }, ID, at, at), false);
        assert.equal(mobs.step(ID, at), undefined);
    });

    it('steps a third of the way to a move, from the server position in 4096ths, then the rest', () => {
        const mobs = new ServerDrivenMobs('1.20.4');
        const at = { x: 0.5, y: 100, z: 0.5 };
        assert.equal(mobs.packets({ s2c: [move('1.20.4', 4096)] }, ID, at, at), true);
        const first = mobs.step(ID, at)!;
        assert.equal(first.y, 100 + (1 / 3) * 1);
        const second = mobs.step(ID, first)!;
        const third = mobs.step(ID, second)!;
        assert.equal(third.y, 101);
        assert.equal(mobs.step(ID, third), undefined);
    });

    it('adds a move in 32nds before 1.9', () => {
        const mobs = new ServerDrivenMobs('1.8.8');
        const at = { x: 0.5, y: 100, z: 0.5 };
        mobs.packets({ s2c: [move('1.8.8', 16)] }, ID, at, at);
        assert.equal(mobs.step(ID, at)!.y, 100 + 0.5 / 3);
    });

    it('ignores another entity\'s packets', () => {
        const mobs = new ServerDrivenMobs('1.20.4');
        const at = { x: 0.5, y: 100, z: 0.5 };
        assert.equal(mobs.packets({ s2c: [move('1.20.4', 4096)] }, ID + 1, at, at), false);
        assert.equal(mobs.step(ID + 1, at), undefined);
    });
});
