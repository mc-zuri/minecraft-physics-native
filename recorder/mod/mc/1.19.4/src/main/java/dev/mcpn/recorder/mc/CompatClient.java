package dev.mcpn.recorder.mc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.network.protocol.game.ServerboundSelectTradePacket;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.network.protocol.game.ServerboundRenameItemPacket;
import net.minecraft.network.protocol.game.ServerboundEditBookPacket;
import net.minecraft.network.protocol.game.ServerboundCommandSuggestionPacket;
import net.minecraft.network.protocol.game.ServerboundSetCommandBlockPacket;
import net.minecraft.world.level.block.entity.CommandBlockEntity;
import net.minecraft.client.gui.screens.DeathScreen;
import net.minecraft.client.gui.screens.inventory.AbstractSignEditScreen;
import net.minecraft.client.gui.screens.inventory.BookEditScreen;
import net.minecraft.client.gui.screens.inventory.CommandBlockEditScreen;
import net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.gui.screens.inventory.MerchantScreen;
import net.minecraft.client.gui.screens.inventory.AnvilScreen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import dev.mcpn.recorder.mc.mixin.AbstractSignEditScreenAccessor;
import dev.mcpn.recorder.mc.mixin.ConfirmScreenAccessor;
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
            case "chat" -> connection.sendChat(action.text);
            case "command" -> connection.sendCommand(action.text);
            case "click" -> mc.gameMode.handleInventoryMouseClick(player.containerMenu.containerId, action.slot, action.button,
                ClickType.valueOf(action.mode == null ? "PICKUP" : action.mode), player);
            case "button" -> mc.gameMode.handleInventoryButtonClick(player.containerMenu.containerId, action.id);
            case "close" -> {
                if (screen != null) screen.onClose();
            }
            case "respawn" -> player.respawn();
            case "selectTrade" -> {
                // MerchantScreen.postButtonClick
                MerchantMenu menu = (MerchantMenu) player.containerMenu;
                menu.setSelectionHint(action.id);
                menu.tryMoveItems(action.id);
                connection.send(new ServerboundSelectTradePacket(action.id));
            }
            case "rename" -> {
                // AnvilScreen.onNameChanged before 1.20: the name goes out at each change but an empty one (the
                // item's own name as "")
                AnvilMenu menu = (AnvilMenu) player.containerMenu;
                String name = action.text;
                if (!name.isEmpty()) {
                    net.minecraft.world.inventory.Slot slot = menu.getSlot(0);
                    if (slot != null && slot.hasItem() && !slot.getItem().hasCustomHoverName() && name.equals(slot.getItem().getHoverName().getString())) name = "";
                    menu.setItemName(name);
                    connection.send(new ServerboundRenameItemPacket(name));
                }
            }
            case "sign" -> {
                // The editor sends its lines when it closes (AbstractSignEditScreen.removed).
                String[] messages = ((AbstractSignEditScreenAccessor) screen).recorder$messages();
                for (int i = 0; i < messages.length; i++) messages[i] = i < action.lines.size() ? action.lines.get(i) : "";
                screen.onClose();
            }
            case "book" -> {
                // BookEditScreen's Done (saveChanges) or BookSignScreen's sign button.
                List<String> pages = new ArrayList<>(action.pages);
                while (!pages.isEmpty() && pages.get(pages.size() - 1).isEmpty()) pages.remove(pages.size() - 1);
                mc.setScreen(null);
                connection.send(new ServerboundEditBookPacket(player.getInventory().selected, pages,
                    Optional.ofNullable(action.title)));
            }
            case "suggest" -> connection.send(new ServerboundCommandSuggestionPacket(action.id, action.text));
            case "commandBlock" -> {
                // CommandBlockEditScreen.populateAndSendPacket, then its Done closes it.
                connection.send(new ServerboundSetCommandBlockPacket(new BlockPos(action.world[0], action.world[1],
                    action.world[2]), action.text, CommandBlockEntity.Mode.valueOf(action.mode == null ? "REDSTONE"
                    : action.mode), true, false, false));
                mc.setScreen(null);
            }
            case "creative" -> mc.gameMode.handleCreativeModeItemAdd(stack(action.item, player.level.registryAccess()), action.slot);
            // ConfirmScreen's Yes (id 1) or No (id 0), e.g. the server resource pack prompt.
            case "confirm" -> ((ConfirmScreenAccessor) screen).recorder$callback().accept(action.id != 0);
            // The selected hotbar slot, as the hotbar keys set it (Inventory.setSelectedSlot; the client sends it on its
            // tick): also with a screen open, where the keys do not reach it.
            case "select" -> player.getInventory().selected = action.id;
            // InBedChatScreen's Leave Bed (sendWakeUp).
            case "wake" -> connection.send(new ServerboundPlayerCommandPacket(player,
                ServerboundPlayerCommandPacket.Action.STOP_SLEEPING));
            // the hit is read before the action runs (CaseRunner): nothing to do
            case "crosshair" -> { }
            default -> throw new IllegalArgumentException("unknown client action " + action.type);
        }
    }

    private static ItemStack stack(Scenario.Item item, net.minecraft.core.HolderLookup.Provider registries) {
        ResourceLocation itemId = new ResourceLocation("minecraft", item.id);
        if (!BuiltInRegistries.ITEM.containsKey(itemId)) {
            throw new IllegalArgumentException("unknown item " + item.id);
        }
        ItemStack stack = new ItemStack(BuiltInRegistries.ITEM.get(itemId), item.count);
        for (Map.Entry<String, Integer> entry : item.enchantments.entrySet()) {
            net.minecraft.world.item.enchantment.Enchantment enchantment = BuiltInRegistries.ENCHANTMENT.get(new ResourceLocation("minecraft", entry.getKey()));
            if (enchantment == null) {
                throw new IllegalArgumentException("unknown enchantment " + entry.getKey());
            }
            if (stack.is(net.minecraft.world.item.Items.ENCHANTED_BOOK)) {
                net.minecraft.world.item.EnchantedBookItem.addEnchantment(stack, new net.minecraft.world.item.enchantment.EnchantmentInstance(enchantment, entry.getValue()));
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
        if (screen instanceof AbstractSignEditScreen) return "sign";
        if (screen instanceof BookEditScreen) return "book";
        if (screen instanceof CommandBlockEditScreen) return "command_block";
        if (screen instanceof CreativeModeInventoryScreen) return "creative";
        if (screen instanceof InventoryScreen) return "inventory";
        if (screen instanceof MerchantScreen) return "merchant";
        if (screen instanceof AnvilScreen) return "anvil";
        if (screen instanceof ConfirmScreen) return "confirm";
        if (screen instanceof InBedChatScreen) return "bed";
        if (screen instanceof AbstractContainerScreen<?> container) {
            try {
                return "container:" + BuiltInRegistries.MENU.getKey(container.getMenu().getType()).getPath();
            } catch (UnsupportedOperationException e) {
                return "container:" + screen.getClass().getSimpleName();
            }
        }
        return screen.getClass().getSimpleName();
    }
}
