import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfig } from './loader.js';
import {
  getBasePathForEmailDomain,
  getBasePathForGitHubOrg,
  getBasePathForJira,
  getBasePathForLinear,
  getBasePathForMeeting,
  getBasePathForSlackWorkspace,
  getCalendarBaseForAccount,
  getEmailBaseForAccount,
  getEntityDirs,
  isKnownSilo,
  siloPath,
  siloRouting,
  UnknownSiloError,
} from './silo-router.js';

const MULTI_SILO_CONFIG = {
  instance: { name: 'test', baseDir: 'C:/' },
  paths: { contentDir: 'C:/content/default' },
  siloRouting: {
    silos: {
      acme: {
        basePath: 'C:/content/acme',
        emailDomains: ['acme.example', 'ACME.TEST'],
        githubOrgs: [
          'acme-corp',
          { githubOrg: 'acme-labs', relativePath: 'labs' },
        ],
        slackWorkspaces: ['T111111'],
        jira: true,
        linear: true,
      },
      globex: {
        basePath: 'C:/content/globex',
        emailDomains: ['globex.example'],
        githubOrgs: ['globex'],
        slackWorkspaces: ['T222222'],
      },
    },
  },
};

const NO_SILO_CONFIG = {
  instance: { name: 'test', baseDir: 'C:/' },
  paths: { contentDir: 'C:/content/default' },
};

const options = { root: '/root' };

function loadMultiSiloConfig() {
  vi.spyOn(fs, 'readFileSync').mockReturnValue(
    JSON.stringify(MULTI_SILO_CONFIG),
  );
  resetConfig();
}

function loadNoSiloConfig() {
  vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(NO_SILO_CONFIG));
  resetConfig();
}

describe('silo-router', () => {
  beforeEach(() => {
    loadNoSiloConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConfig();
  });

  describe('siloRouting', () => {
    it('falls back to paths().contentDir with no silos configured', () => {
      const routing = siloRouting(options);
      expect(routing.defaultBasePath.replace(/\\/g, '/')).toBe(
        'C:/content/default',
      );
      expect(routing.silos).toEqual({});
    });
  });

  describe('siloPath', () => {
    it('joins the default silo when silo is omitted', () => {
      expect(
        siloPath(undefined, ['x', 'karmaniverous'], options).replace(
          /\\/g,
          '/',
        ),
      ).toBe('C:/content/default/x/karmaniverous');
    });

    it('joins a named silo base path', () => {
      loadMultiSiloConfig();
      expect(siloPath('acme', ['meetings'], options).replace(/\\/g, '/')).toBe(
        'C:/content/acme/meetings',
      );
    });

    it('throws UnknownSiloError for an unconfigured silo', () => {
      loadMultiSiloConfig();
      expect(() => siloPath('tcs', ['x'], options)).toThrow(UnknownSiloError);
    });
  });

  describe('isKnownSilo', () => {
    it('is true for undefined (default silo) and false for unknown', () => {
      loadMultiSiloConfig();
      expect(isKnownSilo(undefined, options)).toBe(true);
      expect(isKnownSilo('acme', options)).toBe(true);
      expect(isKnownSilo('tcs', options)).toBe(false);
    });
  });

  describe('getBasePathForEmailDomain', () => {
    it('matches case-insensitively, else default', () => {
      loadMultiSiloConfig();
      expect(getBasePathForEmailDomain('ACME.EXAMPLE', options)).toBe(
        'C:/content/acme',
      );
      expect(getBasePathForEmailDomain('unknown.example', options)).toBe(
        'C:/content/default',
      );
    });
  });

  describe('getBasePathForGitHubOrg', () => {
    it('resolves string and object specs', () => {
      loadMultiSiloConfig();
      expect(getBasePathForGitHubOrg('acme-corp', options)).toBe(
        'C:/content/acme',
      );
      expect(
        getBasePathForGitHubOrg('acme-labs', options).replace(/\\/g, '/'),
      ).toBe('C:/content/acme/labs');
      expect(getBasePathForGitHubOrg('unknown', options)).toBe(
        'C:/content/default',
      );
    });
  });

  describe('getBasePathForSlackWorkspace', () => {
    it('resolves workspace ids', () => {
      loadMultiSiloConfig();
      expect(getBasePathForSlackWorkspace('T111111', options)).toBe(
        'C:/content/acme',
      );
      expect(getBasePathForSlackWorkspace('T999999', options)).toBe(
        'C:/content/default',
      );
    });
  });

  describe('getBasePathForMeeting', () => {
    it('routes to the majority silo, defaults when tied or unmatched', () => {
      loadMultiSiloConfig();
      expect(
        getBasePathForMeeting(
          ['a@acme.example', 'b@acme.example', 'c@globex.example'],
          options,
        ),
      ).toBe('C:/content/acme');
      expect(
        getBasePathForMeeting(['a@acme.example', 'b@globex.example'], options),
      ).toBe('C:/content/default');
      expect(getBasePathForMeeting([], options)).toBe('C:/content/default');
    });
  });

  describe('getBasePathForJira / getBasePathForLinear', () => {
    it('resolves the silo with the flag set, else default', () => {
      loadMultiSiloConfig();
      expect(getBasePathForJira(options)).toBe('C:/content/acme');
      expect(getBasePathForLinear(options)).toBe('C:/content/acme');
      loadNoSiloConfig();
      expect(getBasePathForJira(options)).toBe('C:/content/default');
    });
  });

  describe('getEntityDirs', () => {
    it('deduplicates default + every silo path', () => {
      loadMultiSiloConfig();
      const dirs = getEntityDirs('meetings', options).map((d) =>
        d.replace(/\\/g, '/'),
      );
      expect(dirs).toHaveLength(3);
      expect(dirs).toContain('C:/content/default/meetings');
      expect(dirs).toContain('C:/content/acme/meetings');
      expect(dirs).toContain('C:/content/globex/meetings');
    });
  });

  describe('getEmailBaseForAccount / getCalendarBaseForAccount', () => {
    it('routes by domain, defaults for empty/unknown accounts', () => {
      loadMultiSiloConfig();
      expect(
        getEmailBaseForAccount('user@acme.example', options).replace(
          /\\/g,
          '/',
        ),
      ).toBe('C:/content/acme/email');
      expect(
        getCalendarBaseForAccount('user@globex.example', options).replace(
          /\\/g,
          '/',
        ),
      ).toBe('C:/content/globex/calendar');
      expect(getEmailBaseForAccount('', options).replace(/\\/g, '/')).toBe(
        'C:/content/default/email',
      );
    });
  });
});
