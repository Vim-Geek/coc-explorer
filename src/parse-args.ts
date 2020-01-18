import { config, normalizePath, splitCount } from './util';
import { workspace } from 'coc.nvim';

const { nvim } = workspace;

export interface ArgsSource {
  name: string;
  expand: boolean;
}

export type ArgPosition = 'tab' | 'left' | 'right';

type OptionType = 'boolean' | 'string';

type ArgOption<T> = {
  type: OptionType;
  name: string;
  handler?: (value: string) => Promise<T> | T;
  getDefault?: () => Promise<T> | T;
  description?: string;
};

type ArgOptionRequired<T> = {
  type: OptionType;
  name: string;
  handler?: (value: string) => Promise<T> | T;
  getDefault: () => Promise<T> | T;
  description?: string;
};

export class Args {
  private static registeredOptions: Map<string, ArgOption<any>> = new Map();
  private static registeredPositional = {
    name: 'rootPath',
    handler: (path: string) => normalizePath(path),
    getDefault: async () => {
      let useGetcwd = false;
      const buftype = await nvim.getVar('&buftype');
      if (buftype === 'nofile') {
        useGetcwd = true;
      } else {
        const bufname = await nvim.call('bufname', ['%']);
        if (!bufname) {
          useGetcwd = true;
        }
      }
      const rootPath = useGetcwd ? ((await nvim.call('getcwd', [])) as string) : workspace.rootPath;
      return normalizePath(rootPath);
    },
    description: 'Explorer root',
  };

  private optionValues: Map<string, any> = new Map();
  private rootPathValue?: string;

  static registerOption<T>(
    name: string,
    options: {
      handler?: (value: string) => T | Promise<T>;
      getDefault: () => T | Promise<T>;
    },
  ): ArgOptionRequired<T>;
  static registerOption<T>(
    name: string,
    options: {
      handler?: (value: string) => T | Promise<T>;
    },
  ): ArgOption<T>;
  static registerOption<T>(
    name: string,
    options: {
      handler?: (value: string) => T | Promise<T>;
      getDefault?: () => T | Promise<T>;
    },
  ): ArgOption<T> | ArgOptionRequired<T> {
    const option = {
      type: 'string' as const,
      name,
      ...options,
    };
    this.registeredOptions.set(name, option);
    return option;
  }

  static registerBoolOption(name: string, defaultValue: boolean): ArgOptionRequired<boolean> {
    const option = {
      type: 'boolean' as const,
      name,
      getDefault: () => defaultValue,
    };
    this.registeredOptions.set(name, option);
    this.registeredOptions.set('no-' + name, option);
    return option;
  }

  static async parse(strArgs: string[]) {
    const self = new Args(strArgs);
    const args = [...strArgs];

    while (args.length > 0) {
      const arg = args.shift()!;
      if (arg.startsWith('--')) {
        let key: string, value: undefined | string;

        if (/^--[\w-]+=/.test(arg)) {
          [key, value] = splitCount(arg.slice(2), '=', 2);
        } else {
          key = arg.slice(2);
        }

        const option = this.registeredOptions.get(key);

        if (option) {
          if (!value) {
            if (option.type === 'boolean') {
              self.optionValues.set(option.name, !key.startsWith('no-'));
              continue;
            } else {
              value = args.shift()!;
            }
          }
          if (value !== undefined) {
            self.optionValues.set(
              option.name,
              option.handler ? await option.handler(value) : value,
            );
            continue;
          }
        }
      }

      self.rootPathValue = this.registeredPositional.handler(arg);
    }

    return self;
  }

  constructor(public readonly args: string[]) {}

  has(option: ArgOption<any>): boolean {
    return this.optionValues.has(option.name);
  }

  async value<T>(option: ArgOptionRequired<T>): Promise<T>;
  async value<T>(option: ArgOption<T>): Promise<T | undefined>;
  async value<T>(option: ArgOption<T>): Promise<T | undefined> {
    if (this.optionValues.has(option.name)) {
      return this.optionValues.get(option.name);
    } else {
      if (!Args.registeredOptions.has(option.name)) {
        throw new Error(`Argument(${option.name}) not found`);
      } else {
        return await Args.registeredOptions.get(option.name)?.getDefault?.();
      }
    }
  }

  async rootPath() {
    if (this.rootPathValue === undefined) {
      return await Args.registeredPositional.getDefault();
    } else {
      return this.rootPathValue;
    }
  }
}

type Columns = (string | string[])[];

export const argOptions = {
  toggle: Args.registerBoolOption('toggle', true),
  sources: Args.registerOption('sources', {
    handler: (sources) =>
      sources.split(',').map((source) => {
        let expand = false;
        let name: string;
        if (source.endsWith('+')) {
          expand = true;
          name = source.slice(0, source.length - 1);
        } else if (source.endsWith('-')) {
          expand = false;
          name = source.slice(0, source.length - 1);
        } else {
          name = source;
        }
        return {
          name,
          expand,
        };
      }),
    getDefault: () => config.get<ArgsSource[]>('sources')!,
  }),
  width: Args.registerOption('width', {
    handler: (s) => parseInt(s, 10),
    getDefault: () => config.get<number>('width')!,
  }),
  position: Args.registerOption<ArgPosition>('position', {
    getDefault: () => config.get<ArgPosition>('position')!,
  }),
  bufferColumns: Args.registerOption<Columns>('buffer-columns', {
    handler: parseColumns,
    getDefault: () => config.get<Columns>('buffer.columns')!,
  }),
  fileColumns: Args.registerOption<Columns>('file-columns', {
    handler: parseColumns,
    getDefault: () => config.get<Columns>('file.columns')!,
  }),
  reveal: Args.registerOption('reveal', {
    handler: normalizePath,
  }),
};

export function parseColumns(columnsStr: string) {
  const semicolonIndex = columnsStr.indexOf(';');
  if (semicolonIndex === -1) {
    return columnsStr.split(/:/);
  } else {
    return [
      ...columnsStr
        .slice(0, semicolonIndex)
        .split(':')
        .concat(),
      ...columnsStr
        .slice(semicolonIndex + 1)
        .split(';')
        .map((c) => c.split(':')),
    ];
  }
}
