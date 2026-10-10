import {beforeEach} from 'vitest';
import {pageDataCache} from '../src/lib/page-data-cache';
// Each unit test gets a clean authenticated client cache, like a new browser tab.
beforeEach(()=>pageDataCache.reset());
