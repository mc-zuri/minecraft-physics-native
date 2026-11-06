"""Mojang's 1.14.4 names on a legacy release, by Calamus: its ids follow a class or a member from release to release.

  intermediary(v) <- official(v) <- calamus id -> official(1.14.4) -> Mojang

What 1.14.4 no longer has keeps the release's Yarn name. Written as Tiny v2, intermediary -> named, for Unimined.
usage: legacy_mojmap.py <version> <yarn build> <calamus dir> <overlay dir> <out.tiny>
"""
import collections
import glob
import os
import re
import sys
import zipfile

M = os.path.expanduser('~/.gradle/caches/unimined/mappings/')


def tiny(lines):
    classes, members, owner = {}, {}, None
    head = lines[0].split('\t')[3:]
    for line in lines[1:]:
        p = line.split('\t')
        if p[0] == 'c':
            owner = p[1]
            classes[owner] = p[2:]
        elif len(p) >= 5 and p[0] == '' and p[1] in ('m', 'f'):
            members[(owner, p[1], p[2], p[3])] = p[4:]
    return head, classes, members


def jar(path):
    with zipfile.ZipFile(path) as z:
        return tiny(z.read('mappings/mappings.tiny').decode().splitlines())


def text(path):
    return tiny(open(path, encoding='utf8').read().splitlines())


v, build, cal_dir, overlay, out = sys.argv[1:6]
_, cal_v_c, cal_v_m = jar(f'{cal_dir}/calamus-intermediary-gen2-{v}-v2.jar')
_, cal_14_c, cal_14_m = jar(f'{cal_dir}/calamus-intermediary-gen2-1.14.4-v2.jar')
_, moj_c, moj_m = text(M + 'mappings-COMBINED-intermediary-1.14.4-mojmap-1.14.4.tiny')
_, leg_c, leg_m = text(M + f'mappings-COMBINED-intermediary-{v}-yarn-{v}+build.{build}.tiny')

# calamus id -> Mojang
cal_to_moj = {}
for off, names in cal_14_c.items():
    m = moj_c.get(off)
    if m:
        cal_to_moj[names[0]] = m[1]


def calamus_desc(desc, classes):
    return re.sub(r'L([^;]+);', lambda x: 'L' + (classes[x[1]][0] if x[1] in classes else x[1]) + ';', desc)


cal_mem_moj = {}
for (owner, kind, desc, name), names in cal_14_m.items():
    m = moj_m.get((owner, kind, desc, name))
    if m and owner in cal_14_c:
        # (a Calamus id is the member's own, whichever class declares it)
        cal_mem_moj[(kind, names[0])] = m[1]

# members 1.14 made one across a class and its parent, which the check inside one class cannot see
OWN_NAME = {'method_1378'}

lines = ['tiny\t2\t0\tintermediary\tnamed']
done = collections.Counter()
named_cls = {}
for off, names in leg_c.items():
    inter, yarn = names[0], names[1]
    c = cal_v_c.get(off)
    moj = cal_to_moj.get(c[0]) if c else None
    done['class', moj is not None] += 1
    named_cls[off] = moj or yarn
# a name twice (a class 1.14 split in two, or a Yarn name that is another class's Mojang name): the first Mojang name
# keeps it, the rest take the release's Yarn name, then its intermediary one
taken = collections.defaultdict(list)
for off, name in named_cls.items():
    taken[name].append(off)
for name, offs in taken.items():
    if len(offs) > 1:
        offs.sort(key=lambda o: (cal_to_moj.get(cal_v_c[o][0] if o in cal_v_c else None) != name, o))
        for off in offs[1:]:
            done['class clash'] += 1
            yarn = leg_c[off][1]
            named_cls[off] = yarn if yarn not in taken else leg_c[off][0]
# an inner class without a Mojang name goes with its outer class's name, or it would name an outer class that is not there
for off in sorted(named_cls, key=len):
    if '$' in off and off.rsplit('$', 1)[0] in named_cls and (cal_to_moj.get(cal_v_c[off][0]) if off in cal_v_c else None) is None:
        tail = named_cls[off].rsplit('$', 1)[-1]
        named_cls[off] = named_cls[off.rsplit('$', 1)[0]] + '$' + tail
# (and two inner classes of one name stay two)
seen = set()
for off in sorted(named_cls):
    while named_cls[off] in seen:
        named_cls[off] += '_' + leg_c[off][0].rsplit('_', 1)[-1]
    seen.add(named_cls[off])
by_class = collections.defaultdict(list)
for key, names in leg_m.items():
    by_class[key[0]].append((key, names))
inter_of = {off: n[0] for off, n in leg_c.items()}
for off, names in leg_c.items():
    lines.append(f'c\t{names[0]}\t{named_cls[off]}')
    seen = set()
    for (owner, kind, desc, name), mn in by_class[off]:
        c = cal_v_m.get((owner, kind, desc, name))
        moj = cal_mem_moj.get((kind, c[0])) if c else None
        done['member', moj is not None] += 1
        idesc = re.sub(r'L([^;]+);', lambda x: 'L' + inter_of.get(x[1], x[1]) + ';', desc)
        # (two members 1.14 made one: the second keeps its Yarn name)
        target = mn[1] if mn[0] in OWN_NAME else moj or mn[1]
        if (kind, idesc, target) in seen:
            target = mn[1] if (kind, idesc, mn[1]) not in seen else mn[0]
        seen.add((kind, idesc, target))
        lines.append(f'\t{kind}\t{idesc}\t{mn[0]}\t{target}')
open(out, 'w', encoding='utf8', newline='\n').write('\n'.join(lines) + '\n')
print(v, dict(done))

# how much of what the adapter names has its name here
src = ''.join(open(p, encoding='utf8').read() for p in glob.glob(overlay + '/**/*.java', recursive=True))
used = set(re.findall(r'\bnet\.minecraft(?:\.[a-z0-9_]+)*\.[A-Z]\w*', src))
have = {n.replace('/', '.').replace('$', '.') for n in named_cls.values()}
gone = sorted(u for u in used if u not in have)
print('classes the adapter imports:', len(used), 'not in', v, ':', len(gone))
for g in gone:
    print('   ', g)
