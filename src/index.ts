import type { Bot } from 'mineflayer';
import { LoadNativePhysics } from './native';
import type { NativePhysicsBinding } from './native';

declare module 'mineflayer' {
    interface Bot {
        NativePhysics: NativePhysicsBinding;
    }
}

export default function loader(bot: Bot): void {
    if (!bot.NativePhysics) {
        bot.NativePhysics = LoadNativePhysics();
    }
}

export { LoadNativePhysics } from './native';
export type * from './native';
export * from './mineflayer';
