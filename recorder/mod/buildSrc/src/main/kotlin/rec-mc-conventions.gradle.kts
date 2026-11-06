import xyz.wagyourtail.unimined.api.minecraft.task.RemapJarTask

// A version adapter: Unimined's Minecraft with Fabric loader (no Fabric API), run in the dev
// environment only (no remapped jar), plus `recorderLaunch`, which writes the exact client command
// line to build/recorder-launch.json so recorder/runner can start several clients at once.
plugins {
    id("rec-java-conventions")
    id("xyz.wagyourtail.unimined")
}

dependencies {
    implementation(project(":common"))
}

// One release's sources are the nearest older adapter's with its own on top: mc/<v>/base names that adapter (one line)
// and may list, as "-path/under/src/main", the files this release does not have, and as "=old new", names it moved (a
// class in dotted form, its descriptors follow; applied to all the sources of this release and of those built on it).
// Everything is copied to one tree, so a release overrides a class by holding a file of that name, and the chain stays
// visible in the source directories.
val overlay = layout.buildDirectory.dir("overlay")
val overlayChain: List<File> = generateSequence(projectDir) { dir ->
    val base = File(dir, "base")
    if (base.exists()) File(dir.parentFile, base.readLines().first().trim()) else null
}.toList()
val renames: List<Pair<String, String>> = overlayChain.reversed().flatMap { dir ->
    val base = File(dir, "base")
    if (base.exists()) base.readLines().drop(1).map { it.trim() }.filter { it.startsWith("=") }.map { it.drop(1).trim().split(Regex("\\s+"), 2) }
        .flatMap { (old, new) -> listOf(old to new, old.replace('.', '/') to new.replace('.', '/')) } else emptyList()
}.distinct()
val renameRules = renames.map { (old, new) -> Regex("(?<![\\w$])" + Regex.escape(old) + "(?![\\w$])") to new }
val overlaySources = tasks.register<Sync>("overlaySources") {
    into(overlay)
    inputs.property("renames", renames.toString())
    if (renameRules.isNotEmpty()) {
        filesMatching(listOf("**/*.java", "**/*.json")) {
            filter { line: String -> renameRules.fold(line) { text, (old, new) -> old.replace(text, Regex.escapeReplacement(new)) } }
        }
    }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    // nearest first: a file copied once is not replaced by an older adapter's
    overlayChain.forEachIndexed { index, dir ->
        val removed = overlayChain.take(index).flatMap { nearer ->
            val base = File(nearer, "base")
            if (base.exists()) base.readLines().drop(1).map { it.trim() }.filter { it.startsWith("-") }.map { it.drop(1) } else emptyList()
        }
        from(File(dir, "src/main")) {
            exclude(removed)
            // a removed mixin leaves the mixin list too (it must not be the last of its array)
            val mixins = overlayChain.flatMap { nearer ->
                val base = File(nearer, "base")
                if (base.exists()) base.readLines().drop(1).map { it.trim() }.filter { it.endsWith("Mixin.java") || it.endsWith("Accessor.java") }
                    .map { "\"" + it.substringAfterLast('/').removeSuffix(".java") + "\"" } else emptyList()
            }
            filesMatching("**/recorder.mixins.json") {
                filter { line: String -> if (mixins.any { line.contains(it) }) null else line }
            }
        }
    }
}
the<SourceSetContainer>().named("main") {
    java.setSrcDirs(listOf(overlay.map { it.dir("java") }))
    resources.setSrcDirs(listOf(overlay.map { it.dir("resources") }))
}
tasks.named("compileJava") { dependsOn(overlaySources) }
tasks.named("processResources") { dependsOn(overlaySources) }

tasks.withType<RemapJarTask> {
    onlyIf { false }
}

afterEvaluate {
    tasks.processResources {
        filteringCharset = "UTF-8"
        filesMatching("fabric.mod.json") {
            expand("version" to rootProject.version, "minecraft" to project.name)
        }
    }
}

// runClient forwards -Precorder.* as -Drecorder.* (e.g. -Precorder.scenarios=<dir> -Precorder.filter=walk/*)
afterEvaluate {
    tasks.matching { it.name == "runClient" }.configureEach {
        val exec = this as JavaExec
        val recorderRoot = rootProject.projectDir.parentFile
        exec.systemProperty("recorder.scenarios", File(recorderRoot, "out/scenarios/${project.name}").absolutePath)
        exec.systemProperty("recorder.out", File(recorderRoot, "out/recordings/${project.name}").absolutePath)
        project.properties.filterKeys { it.startsWith("recorder.") }.forEach { (key, value) ->
            exec.systemProperty(key, value.toString())
        }
    }
}

afterEvaluate {
    val run = tasks.findByName("runClient") as? xyz.wagyourtail.unimined.api.runs.RunConfig ?: return@afterEvaluate
    tasks.register("recorderLaunch") {
        dependsOn(run.taskDependencies)
        val out = layout.buildDirectory.file("recorder-launch.json")
        outputs.upToDateWhen { false }
        doLast {
            // RunConfig substitutes ${property} placeholders right before it launches; do the same here.
            fun resolve(value: String): String = run.properties.entries.fold(value) { acc, (key, supplier) ->
                acc.replace("\${$key}", supplier())
            }
            val launch = mapOf(
                "version" to project.name,
                "java" to run.javaLauncher.get().executablePath.asFile.absolutePath,
                "workingDir" to run.workingDir.absolutePath,
                "jvmArgs" to run.allJvmArgs.map(::resolve),
                "classpath" to run.classpath.files.map { it.absolutePath },
                "mainClass" to run.mainClass.get(),
                "args" to run.args!!.map { resolve(it.toString()) }
            )
            out.get().asFile.writeText(groovy.json.JsonOutput.prettyPrint(groovy.json.JsonOutput.toJson(launch)))
        }
    }
}
