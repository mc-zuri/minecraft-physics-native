package dev.mcpn.recorder.mc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
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
                // AnvilScreen.onNameChanged
                AnvilMenu menu = (AnvilMenu) player.containerMenu;
                if (menu.setItemName(action.text)) connection.send(new ServerboundRenameItemPacket(action.text));
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
            case "creative" -> mc.gameMode.handleCreativeModeItemAdd(stack(action.item, player.registryAccess()), action.slot);
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
        Optional<Holder.Reference<Item>> type = BuiltInRegistries.ITEM.getHolder(ResourceLocation.withDefaultNamespace(item.id));
        if (type.isEmpty()) {
            throw new IllegalArgumentException("unknown item " + item.id);
        }
        ItemStack stack = new ItemStack(type.get(), item.count);
        if (!item.enchantments.isEmpty()) {
            var enchantments = registries.lookupOrThrow(Registries.ENCHANTMENT);
            net.minecraft.world.item.enchantment.EnchantmentHelper.updateEnchantments(stack, mutable -> {
                for (Map.Entry<String, Integer> enchantment : item.enchantments.entrySet()) {
                    mutable.upgrade(enchantments.getOrThrow(ResourceKey.create(Registries.ENCHANTMENT,
                        ResourceLocation.withDefaultNamespace(enchantment.getKey()))), enchantment.getValue());
                }
            });
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
