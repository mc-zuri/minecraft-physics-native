plugins {
    `kotlin-dsl`
}

repositories {
    maven("https://maven.wagyourtail.xyz/releases") {
        name = "WagYourReleases"
    }
    maven("https://maven.wagyourtail.xyz/snapshots") {
        name = "WagYourSnapshots"
    }
    gradlePluginPortal()
    mavenCentral()
}

dependencies {
    // One build of the 1.3.16 snapshot, never what the snapshot's name points at today. gradle/verification-metadata.xml
    // holds its hash, so the same bytes or nothing.
    implementation("xyz.wagyourtail.unimined:unimined:1.3.16-20260511.125954-9")
}
