package dev.mcpn.recorder.mc;

import io.netty.buffer.Unpooled;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.protocol.game.ServerboundCustomPayloadPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.level.block.entity.CommandBlockEntity;
import net.minecraft.client.gui.screens.DeathScreen;
import net.minecraft.client.gui.screens.inventory.SignEditScreen;
import net.minecraft.client.gui.screens.inventory.BookEditScreen;
import net.minecraft.client.gui.screens.inventory.CommandBlockEditScreen;
import net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.gui.screens.inventory.MerchantScreen;
import net.minecraft.client.gui.screens.inventory.AnvilScreen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import dev.mcpn.recorder.mc.mixin.AbstractSignEditScreenAccessor;
import net.minecraft.network.protocol.game.ServerboundPlayerCommandPacket;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.InBedChatScreen;
import dev.mcpn.recorder.model.Scenario;

/** The player's client actions: what a screen's buttons and the chat box do. */
final class CompatClient {
    private CompatClient() {
    }

    static void act(Minecraft mc, Scenario.Client action) {
        LocalPlayer player = mc.player;
        ClientPacketListener connection = player.connection;
        Screen screen = mc.screen;
        switch (action.type) {
            case "chat" -> player.chat(action.text);
            case "command" -> player.chat("/" + action.text);
            case "click" -> mc.gameMode.handleInventoryMouseClick(player.containerMenu.containerId, action.slot, action.button,
                ClickType.valueOf(action.mode == null ? "PICKUP" : action.mode), player);
            case "button" -> mc.gameMode.handleInventoryButtonClick(player.containerMenu.containerId, action.id);
            case "close" -> {
                // a container screen closed as its inventory key closes it (closeContainer: close_window); before
                // 1.16 Escape runs Screen.onClose, which only clears the screen and never tells the server
                if (screen instanceof net.minecraft.client.gui.screens.inventory.AbstractContainerScreen) player.closeContainer();
                else if (screen != null) mc.setScreen(null);
            }
            case "respawn" -> player.respawn();
            case "selectTrade" -> {
                // MerchantScreen.postButtonClick
                MerchantMenu menu = (MerchantMenu) player.containerMenu;
                // (before 1.14 the screen pages through the trades, and moves no items into the slots)
                menu.setSelectionHint(action.id);
                // (before 1.13 the page goes out on the MC|TrSel channel)
                FriendlyByteBuf page = new FriendlyByteBuf(Unpooled.buffer());
                page.writeInt(action.id);
                connection.send(new ServerboundCustomPayloadPacket("MC|TrSel", page));
            }
            case "rename" -> {
                // AnvilScreen.onNameChanged before 1.20: the name goes out at each change but an empty one (the
                // item's own name as "")
                AnvilMenu menu = (AnvilMenu) player.containerMenu;
                String name = action.text;
                // (before 1.13 it goes out at each change, an empty one too, on the MC|ItemName channel)
                net.minecraft.world.inventory.Slot slot = menu.getSlot(0);
                if (slot != null && slot.hasItem() && !slot.getItem().hasCustomHoverName() && name.equals(slot.getItem().getHoverName())) name = "";
                menu.setItemName(name);
                connection.send(new ServerboundCustomPayloadPacket("MC|ItemName", new FriendlyByteBuf(Unpooled.buffer()).writeUtf(name)));
            }
            case "sign" -> {
                // The editor sends its lines when it closes (AbstractSignEditScreen.removed).
                net.minecraft.world.level.block.entity.SignBlockEntity sign = ((AbstractSignEditScreenAccessor) screen).recorder$sign();
                for (int i = 0; i < 4; i++) sign.messages[i] = new net.minecraft.network.chat.TextComponent(i < action.lines.size() ? action.lines.get(i) : "");
                sign.setChanged();
                mc.setScreen(null);
            }
            case "book" -> {
                // BookEditScreen's Done (saveChanges) or BookSignScreen's sign button.
                List<String> pages = new ArrayList<>(action.pages);
                while (!pages.isEmpty() && pages.get(pages.size() - 1).isEmpty()) pages.remove(pages.size() - 1);
                mc.setScreen(null);
                ItemStack book = player.getMainHandItem().copy();
                net.minecraft.nbt.ListTag list = new net.minecraft.nbt.ListTag();
                for (String page : pages) list.add(new net.minecraft.nbt.StringTag(page));
                book.addTagElement("pages", list);
                if (action.title != null) {
                    book.addTagElement("author", new net.minecraft.nbt.StringTag(player.getGameProfile().getName()));
                    book.addTagElement("title", new net.minecraft.nbt.StringTag(action.title.trim()));
                }
                FriendlyByteBuf written = new FriendlyByteBuf(Unpooled.buffer());
                written.writeItem(book);
                connection.send(new ServerboundCustomPayloadPacket(action.title != null ? "MC|BSign" : "MC|BEdit", written));
            }
            case "suggest" -> connection.send(new net.minecraft.network.packet.c2s.play.RequestCommandCompletionsC2SPacket(action.text,
                mc.hitResult != null && mc.hitResult.type == net.minecraft.world.phys.HitResult.Type.BLOCK ? mc.hitResult.getBlockPos() : null, false));
            case "commandBlock" -> {
                // CommandBlockEditScreen's Done before 1.13: on the MC|AutoCmd channel
                FriendlyByteBuf block = new FriendlyByteBuf(Unpooled.buffer());
                block.writeInt(action.world[0]);
                block.writeInt(action.world[1]);
                block.writeInt(action.world[2]);
                block.writeUtf(action.text);
                block.writeBoolean(true);
                block.writeUtf(action.mode == null ? "REDSTONE" : action.mode);
                block.writeBoolean(false);
                block.writeBoolean(false);
                connection.send(new ServerboundCustomPayloadPacket("MC|AutoCmd", block));
                mc.setScreen(null);
            }
            case "creative" -> mc.gameMode.handleCreativeModeItemAdd(stack(action.item, null), action.slot);
            // ConfirmScreen's Yes (id 1) or No (id 0), e.g. the server resource pack prompt.
            case "confirm" -> {
                dev.mcpn.recorder.mc.mixin.ConfirmAccessor confirm = (dev.mcpn.recorder.mc.mixin.ConfirmAccessor) screen;
                confirm.recorder$callback().confirmLink(action.id != 0, confirm.recorder$identifier());
            }
            // The selected hotbar slot, as the hotbar keys set it (Inventory.setSelectedSlot; the client sends it on its
            // tick): also with a screen open, where the keys do not reach it.
            case "select" -> player.inventory.selected = action.id;
            // InBedChatScreen's Leave Bed (sendWakeUp).
            case "wake" -> connection.send(new ServerboundPlayerCommandPacket(player,
                ServerboundPlayerCommandPacket.Action.STOP_SLEEPING));
            // the hit is read before the action runs (CaseRunner): nothing to do
            case "crosshair" -> { }
            default -> throw new IllegalArgumentException("unknown client action " + action.type);
        }
    }

    private static ItemStack stack(Scenario.Item item, Object registries) {
        if (item.id.equals("air")) {
            // (an empty slot is no stack before 1.11)
            return null;
        }
        ResourceLocation itemId = new ResourceLocation("minecraft", item.id);
        if (!net.minecraft.world.item.Item.REGISTRY.containsKey(itemId)) {
            throw new IllegalArgumentException("unknown item " + item.id);
        }
        ItemStack stack = new ItemStack(net.minecraft.world.item.Item.REGISTRY.get(itemId), item.count, item.damage);
        for (Map.Entry<String, Integer> entry : item.enchantments.entrySet()) {
            net.minecraft.world.item.enchantment.Enchantment enchantment = net.minecraft.world.item.enchantment.Enchantment.REGISTRY.get(new ResourceLocation("minecraft", entry.getKey()));
            if (enchantment == null) {
                throw new IllegalArgumentException("unknown enchantment " + entry.getKey());
            }
            if (stack.getItem() == net.minecraft.world.item.Items.ENCHANTED_BOOK) {
                ((net.minecraft.world.item.EnchantedBookItem) net.minecraft.world.item.Items.ENCHANTED_BOOK).addEnchantment(stack, new net.minecraft.world.item.enchantment.EnchantmentInstance(enchantment, entry.getValue()));
            } else {
                stack.enchant(enchantment, entry.getValue());
            }
        }
        return stack;
    }

    static String screen(Minecraft mc) {
        Screen screen = mc.screen;
        if (screen == null) return "none";
        if (screen instanceof DeathScreen) return "death";
        if (screen instanceof SignEditScreen) return "sign";
        if (screen instanceof BookEditScreen) return "book";
        if (screen instanceof CommandBlockEditScreen) return "command_block";
        if (screen instanceof CreativeModeInventoryScreen) return "creative";
        if (screen instanceof InventoryScreen) return "inventory";
        if (screen instanceof MerchantScreen) return "merchant";
        if (screen instanceof AnvilScreen) return "anvil";
        if (screen instanceof ConfirmScreen) return "confirm";
        if (screen instanceof InBedChatScreen) return "bed";
        if (screen instanceof AbstractContainerScreen container) {
            try {
                return "container:" + CompatMove.menuType(container);
            } catch (UnsupportedOperationException e) {
                return "container:" + screen.getClass().getSimpleName();
            }
        }
        return screen.getClass().getSimpleName();
    }
}
