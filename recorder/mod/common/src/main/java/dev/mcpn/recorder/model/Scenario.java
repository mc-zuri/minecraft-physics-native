package dev.mcpn.recorder.model;

import java.util.List;
import java.util.Map;

/**
 * A compiled scenario as recorder/scenarios/build.ts writes it (recorder/schema/scenario.ts,
 * CompiledScenario). Read with Gson; tagged unions are flattened into one class with every
 * variant's fields, told apart by `op`.
 */
public final class Scenario {
    public String id;
    public String hash;
    public List<String> tags;
    /** A case about the game's features: it opens screens, and they stay open. */
    public boolean features;
    /** The player can be hurt and die in this case; every other case keeps it invulnerable. */
    public boolean mortal;
    /** The world's difficulty in this case; peaceful when null. */
    public String difficulty;
    /** The case ends the connection: no world comes back, so it runs last and ends its client's run. */
    public boolean disconnects;
    public Area area;
    public Start start;
    public Setup setup;
    public List<Step> body;
    public List<Expectation> expect;
    public int maxTicks;

    public static final class Area {
        public String name;
        /** [minX, minY, minZ, maxX, maxY, maxZ] relative to the origin, inclusive. */
        public int[] box;
        public List<Fill> fills;
        /** The area's own absolute origin (far coordinates); the recorder's default when null. */
        public int[] origin;
    }

    public static final class Fill {
        public int[] from;
        public int[] to;
        public String block;
        public boolean update;
    }

    public static final class Start {
        public double[] pos;
        public float yRot;
        public float xRot;
        public double[] vel;
        public boolean grounded;
        /** Where to rest before the teleport to the start (a fall starting mid-air); the start when null. */
        public double[] rest;
        /** Wait until still at the rest point before the start. */
        public boolean settle = true;
    }

    public static final class Effect {
        public String id;
        public int amplifier;
        public int duration;
        public Boolean ambient;
        public Boolean visible;
    }

    public static final class Modifier {
        public String uuid;
        public String key;
        public double amount;
        public String operation;
    }

    public static final class Attribute {
        public String id;
        public Double base;
        public List<Modifier> modifiers;
    }

    public static final class Item {
        public String id;
        public int count = 1;
        /** The variant, before 1.13. */
        public int damage;
        public Map<String, Integer> enchantments;
    }

    public static final class Summon {
        public String ref;
        public String type;
        public double[] pos;
        public double[] vel;
        public Float yRot;
        public Float xRot;
        public boolean noAi = true;
        public Boolean noGravity;
        public String nbt;
        /** Tamed, and saddled where it takes a saddle. */
        public boolean ready;
        /** Equipment slot (saddle, body, mainhand, ...) -> item id. */
        public Map<String, String> equipment;
        public boolean chested;
        /** Attribute registry name -> base value ("step_height" before 1.20.5: must equal the type's own). */
        public Map<String, Double> attributes;
    }

    public static final class Abilities {
        public Boolean mayfly;
        public Boolean flying;
        public Float flyingSpeed;
        public Float walkingSpeed;
    }

    public static final class Setup {
        public String gameMode = "survival";
        public List<Effect> effects;
        public List<Attribute> attributes;
        public Map<String, Item> equipment;
        /** Inventory index (0-8 hotbar, 9-35 main, 36-39 armor, 40 offhand) -> item. */
        public Map<String, Item> inventory;
        public int selectedSlot;
        public int food = 20;
        public Abilities abilities;
        public List<Summon> summons;
        public String mount;
        /** Server commands run at the end of the setup. */
        public List<String> commands;
        public boolean autoJump;
        public boolean allowFlight = true;
    }

    /** A condition (scenario.ts Condition). */
    public static final class Condition {
        public String op;
        public double epsilon;
        public String block;
        public String how;
        public String field;
        public String cmp;
        public double value;
        public List<Condition> all;
        public List<Condition> any;
        public Condition cond;
        /** op "const": the value it has */
        public boolean holds;
    }

    /** A server action (scenario.ts ServerAction). */
    public static final class Action {
        public String op;
        public String target;
        public double[] vel;
        public double strength;
        public double dx;
        public double dz;
        public double[] pos;
        public Float yRot;
        public Float xRot;
        public List<String> relative;
        public float power;
        public String block;
        public boolean update;
        public int[] from;
        public int[] to;
        public Effect effect;
        public String id;
        public Attribute attribute;
        public Boolean mayfly;
        public Boolean flying;
        public Float flyingSpeed;
        public Float walkingSpeed;
        public String gameMode;
        public Summon summon;
        public String ref;
        public String slot;
        public Item item;
        public String command;
        public int food;
        public String header;
        public String footer;
        public int stage;
        public String reason;
        public String url;
        public String packHash;
        public boolean required;
        public String prompt;
        public boolean pop;
        public Boolean noGravity;
    }

    /** A body step (scenario.ts Step). */
    public static final class Step {
        public String op;
        public List<String> keys;
        public int ticks;
        public float yRot;
        public float xRot;
        public float dyRot;
        public float dxRot;
        public Condition cond;
        public int max;
        public boolean soft;
        public int slot;
        public Action action;
        public Client client;
        public String screen;
    }

    /** What the player does through the client's own code paths. */
    public static final class Client {
        public String type;
        public String text;
        public int slot;
        public int button;
        public String mode;
        public int id;
        public List<String> lines = new java.util.ArrayList<>();
        public boolean front = true;
        public List<String> pages = new java.util.ArrayList<>();
        public String title;
        /** Area-local block position; the runner resolves it to world coordinates in {@link #world}. */
        public int[] at;
        public transient int[] world;
        public Item item;
    }

    public static final class Expectation {
        public String op;
        public String block;
        public String how;
        public boolean allowed;
        public Condition cond;
    }
}
