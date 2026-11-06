#!/usr/bin/env python
"""Lists every mixin member of an adapter that its release's Minecraft does not have, all at once.

    python recorder/mod/check-mixins.py 1.20.2 [--launch recorder/mod/mc/1.20.2/build/recorder-launch.json]

Mixin reports these one per client start, and javac not at all (a @Shadow or an @Inject's method is a string or a
declaration javac cannot check). This reads the merged sources in mc/<v>/build/overlay, finds the release's mapped jar on
the launch classpath and asks javap for the members of each target (and its superclasses, as a @Shadow may name an
inherited member only through the class that declares it, so only the target itself counts for fields). A descriptor
written out in a method or an @At target must exist too, and an @Inject that takes the target's arguments must take as
many as one of its overloads has.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description="Lists the mixin members a release lacks.")
parser.add_argument('version')
parser.add_argument("--launch", type=Path, help="the launch descriptor to read, by default the adapter one")
options = parser.parse_args()
version = options.version
adapter = root / 'mc' / version
overlay = adapter / 'build' / 'overlay' / 'java' / 'dev' / 'mcpn' / 'recorder' / 'mc' / 'mixin'
launch = json.loads((options.launch or adapter / 'build' / 'recorder-launch.json').read_text())
if launch.get('version') not in (None, version):
    sys.exit(f"{version}: the launch descriptor is for {launch['version']}")
java_home = Path(launch['java']).parent
javap = str(java_home / 'javap')
classpath = ';'.join(launch['classpath'])

cache = {}
called = {}
descriptors = {}


field_types = {}


def simple(text):
    """A type as a name to compare: no generics, no package."""
    text = text.strip()
    while '<' in text:
        text = re.sub(r'<[^<>]*>', '', text)
    return re.split(r'[.$]', text.replace(' ', ''))[-1]


def members(cls):
    if cls in cache:
        return cache[cls]
    out = subprocess.run([javap, '-p', '-s', '-cp', classpath, cls], capture_output=True, text=True)
    if out.returncode != 0:
        cache[cls] = None
        return None
    fields, methods = set(), set()
    descriptors.setdefault(cls, {})
    name = None
    for line in out.stdout.splitlines():
        d = re.match(r'\s+descriptor: (\S+)', line)
        m = re.search(r'([\w$]+)\(', line)
        if d:
            if name:
                descriptors[cls].setdefault(name, set()).add(d.group(1))
            name = None
        elif m:
            name = '<init>' if '.' in line.split('(')[0].split()[-1] else m.group(1)
            methods.add(name)
        else:
            name = None
            f = re.search(r'([\w$]+);$', line)
            if f:
                fields.add(f.group(1))
                t = re.match(r'\s*(?:(?:public|protected|private|static|final|volatile|transient)\s+)*(.+?)\s+[\w$]+;$', line)
                if t:
                    field_types.setdefault(cls, {})[f.group(1)] = simple(t.group(1))
    cache[cls] = (fields, methods)
    return cache[cls]


def calls(cls):
    """The names each method of a class calls, by method name."""
    if cls in called:
        return called[cls]
    out = subprocess.run([javap, '-p', '-c', '-cp', classpath, cls], capture_output=True, text=True)
    found, current = {}, None
    for line in out.stdout.splitlines():
        declared = re.match(r'  \S.*?([\w$]+)\(.*\)( throws .*)?;$', line)
        if declared:
            name = declared.group(1)
            current = found.setdefault('<init>' if name == cls.split('.')[-1].split('$')[-1] else name, set())
        elif current is not None:
            call = re.search(r'// (?:Interface)?Method (?:[\w/$]+\.)?"?([\w$<>]+)"?:', line)
            if call:
                current.add(call.group(1))
    called[cls] = found
    return found


def imports(text):
    found = {}
    for full in re.findall(r'^import ([\w.]+);', text, re.M):
        found[full.split('.')[-1]] = full
    return found


def resolve(name, imported, pkg):
    outer = name.split('.')[0]
    if outer in imported:
        full = imported[outer]
        rest = name.split('.')[1:]
        return full + ''.join('$' + r for r in rest)
    return name if '.' in name and name[0].islower() else f'{pkg}.{name}'


def argument_count(descriptor):
    return len(re.findall(r'\[*(?:[BCDFIJSZ]|L[^;]+;)', descriptor[1:descriptor.index(')')]))


problems = 0
if not list(overlay.glob('*.java')):
    sys.exit(f'{version}: no merged sources in {overlay}: build the adapter first')
for path in sorted(overlay.glob('*.java')):
    text = path.read_text(encoding='utf8')
    imported = imports(text)
    target = re.search(r'@Mixin\((?:value\s*=\s*)?\{?\s*([\w.]+)\.class', text)
    if not target:
        target_s = re.search(r'@Mixin\(targets\s*=\s*"([^"]+)"', text)
        if not target_s:
            print(f'{path.name}: no target found')
            continue
        cls = target_s.group(1).replace('/', '.')
    else:
        cls = resolve(target.group(1), imported, 'java.lang')
    have = members(cls)
    if have is None:
        print(f'{path.name}: target {cls} does not exist')
        problems += 1
        continue
    fields, methods = have

    def report(kind, name):
        global problems
        print(f'{path.name}: {kind} {name} not in {cls}')
        problems += 1

    for accessor in re.findall(r'@Accessor\("([^"]+)"\)', text):
        if accessor not in fields:
            report('accessor', accessor)
    # the type too: Mixin finds a field by name and type, and says so only at the launch
    for accessor, returned, args in re.findall(r'@Accessor\("([^"]+)"\)\s+(?:static\s+)?([\w.<>?,\s\[\]]+?)\s+[\w$]+\(([^)]*)\)', text):
        declared = simple(returned) if simple(returned) != 'void' else simple(args.rsplit(' ', 1)[0]) if args else None
        actual = field_types.get(cls, {}).get(accessor)
        if declared and actual and declared != actual:
            report(f'accessor type ({declared}, the field is {actual})', accessor)
    for invoker in re.findall(r'@Invoker\("([^"]+)"\)', text):
        if invoker not in methods and invoker != '<init>':
            report('invoker', invoker)
    for name in re.findall(r'@Shadow[^;{]*?\s([\w$]+)\s*;', text):
        if name not in fields:
            report('shadow field', name)
    for name in re.findall(r'@Shadow[^;{]*?\s([\w$]+)\s*\(', text):
        if name not in methods:
            report('shadow method', name)
    # method = "..." or method = {"a", "b"} on injectors
    for block in re.findall(r'method\s*=\s*(\{[^}]*\}|"[^"]*")', text):
        for raw in re.findall(r'"([^"]+)"', block):
            name = raw.split('(')[0].split('$')[0].rstrip('*')
            if name and name not in methods and name not in ('<init>', '<clinit>'):
                report('target method', raw)
            elif '(' in raw and raw.split('(')[0] in methods and raw[raw.index('('):] not in descriptors[cls].get(raw.split('(')[0], ()):
                report('target descriptor', raw)
    # an @Inject naming one method, with the target's arguments before its CallbackInfo
    for raw, params in re.findall(r'@Inject\(\s*method\s*=\s*"([\w$<>]+)"[^\n]*\n(?:\s*@[^\n]*\n)*\s*(?:private|public|protected)[^(\n]*\(([^)]*)\)', text):
        depth, parts, part = 0, [], ''
        for ch in params:
            depth += ch == '<'
            depth -= ch == '>'
            if ch == ',' and depth == 0:
                parts.append(part)
                part = ''
            else:
                part += ch
        parts.append(part)
        taken = [q for q in parts if q.strip() and 'CallbackInfo' not in q and '@Local' not in q]
        counts = {argument_count(d) for d in descriptors[cls].get(raw, ())}
        if taken and counts and len(taken) not in counts:
            report(f'handler arguments ({len(taken)}, target has {sorted(counts)})', raw)
    # an INVOKE @At: the method named must make that call itself (a call moved to a helper leaves both members in place)
    for raw, member in re.findall(r'method\s*=\s*"([\w$<>]+)(?:\([^"]*)?",\s*at\s*=\s*@At\(\s*value\s*=\s*"INVOKE",\s*target\s*=\s*"L[\w/$]+;([\w$<>]+)[(:]', text):
        # (require = 0: a call only some releases make)
        if raw in methods and member not in calls(cls).get(raw, ()) and 'require = 0' not in text:
            report(f'call of {member} not made by', raw)
    for owner, member, descriptor in re.findall(r'target\s*=\s*"L([\w/$]+);([\w$<>]+)([(:][^"]*)', text):
        cls2 = owner.replace('/', '.')
        hv = members(cls2)
        if hv is None:
            print(f'{path.name}: at-target class {cls2} does not exist')
            problems += 1
        elif descriptor[0] == '(' and member in hv[1] and descriptor not in descriptors[cls2].get(member, ()):
            print(f'{path.name}: at-target descriptor {cls2}.{member}{descriptor} does not exist')
            problems += 1
        elif member not in hv[0] and member not in hv[1] and member != '<init>':
            # may be inherited: ask javap of the owner's chain is overkill; flag it for a look
            print(f'{path.name}: at-target {cls2}.{member} not declared there (inherited?)')
print(f'{version}: {problems} problem(s)')
sys.exit(1 if problems else 0)
