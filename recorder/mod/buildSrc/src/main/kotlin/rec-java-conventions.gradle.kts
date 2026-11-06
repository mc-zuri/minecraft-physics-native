plugins {
    `java-library`
}

// (a jar on a client's classpath is part of the build's identity: its bytes follow what it holds, not when it was built)
tasks.withType<AbstractArchiveTask> {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
