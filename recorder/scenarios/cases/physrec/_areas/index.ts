// Every area the ported cases name, made known to kase() (the coverage modules register their own).
import { registerAreas } from '../../../dsl/physrec.ts'
import javaAreas from './java-areas.ts'
import manualAreas from './manual-areas.ts'
import observerAreas from './observer-areas.ts'

registerAreas(observerAreas, javaAreas, manualAreas)
