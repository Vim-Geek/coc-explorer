import { extensions, workspace } from 'coc.nvim';
import pathLib from 'path';
import { Location, Range } from 'vscode-languageserver-protocol';
import { internalEvents } from '../../../events';
import { debounce, fsExists, normalizePath } from '../../../util';
import { hlGroupManager } from '../../../highlight/manager';
import { BaseTreeNode, ExplorerSource } from '../../source';
import { sourceManager } from '../../sourceManager';
import { SourcePainters } from '../../sourcePainters';
import { bookmarkArgOptions } from './argOptions';
import { bookmarkColumnRegistrar } from './bookmarkColumnRegistrar';
import './load';
import BookmarkDB from './util/db';
import { decode } from './util/encodeDecode';

export interface BookmarkNode
  extends BaseTreeNode<BookmarkNode, 'root' | 'child'> {
  fullpath: string;
  filename: string;
  lnum: number;
  line: string;
  annotation: string | undefined;
}

export namespace BookmarkDB {
  export type Filepath = string;
  export type LineString = string;

  export interface Item {
    line: string;
    filetype: string;
    annotation?: string;
  }

  export type Collection = Record<LineString, Item>;
  export type Data = Record<Filepath, Collection>;
}

const hl = hlGroupManager.linkGroup.bind(hlGroupManager);

export const bookmarkHighlights = {
  title: hl('BookmarkRoot', 'Constant'),
  hidden: hl('BookmarkHidden', 'Commment'),
  expandIcon: hl('BookmarkExpandIcon', 'Directory'),
  filename: hl('BookmarkFilename', 'String'),
  fullpath: hl('BookmarkFullpath', 'Special'),
  position: hl('BookmarkPosition', 'Comment'),
  line: hlGroupManager.group(
    'BookmarkLine',
    'ctermbg=27 ctermfg=0 guibg=#1593e5 guifg=#ffffff',
  ),
  annotation: hl('BookmarkAnnotation', 'Comment'),
};

export class BookmarkSource extends ExplorerSource<BookmarkNode> {
  rootNode: BookmarkNode = {
    type: 'root',
    isRoot: true,
    expandable: true,
    uid: this.helper.getUid('0'),
    fullpath: '',
    filename: '',
    lnum: -1,
    line: '',
    annotation: undefined,
  };
  sourcePainters: SourcePainters<BookmarkNode> = new SourcePainters<BookmarkNode>(
    this,
    bookmarkColumnRegistrar,
  );

  static get enabled(): boolean | Promise<boolean> {
    return extensions.getExtensionState('coc-bookmark') === 'activated';
  }

  async init() {
    if (this.config.get('activeMode')) {
      this.disposables.push(
        internalEvents.on(
          'CocBookmarkChange',
          debounce(500, async () => {
            await this.load(this.rootNode);
          }),
        ),
      );
    }
  }

  async open() {
    await this.sourcePainters.parseTemplate(
      'root',
      await this.explorer.args.value(bookmarkArgOptions.bookmarkRootTemplate),
    );
    await this.sourcePainters.parseTemplate(
      'child',
      await this.explorer.args.value(bookmarkArgOptions.bookmarkChildTemplate),
      await this.explorer.args.value(
        bookmarkArgOptions.bookmarkChildLabelingTemplate,
      ),
    );

    this.rootNode.fullpath = this.explorer.rootUri;
  }

  async loadChildren(parentNode: BookmarkNode) {
    const extRoot = workspace.env.extensionRoot;
    const bookmarkPath = pathLib.join(
      extRoot,
      'coc-bookmark-data/bookmark.json',
    );
    const db = new BookmarkDB(bookmarkPath);
    const data = (await db.load()) as BookmarkDB.Data;

    const bookmarkNodes: BookmarkNode[] = [];
    for (const [filepath, bookmarks] of Object.entries(data)) {
      const fullpath = normalizePath(decode(filepath));
      if (
        (!this.showHidden && !fullpath.startsWith(parentNode.fullpath)) ||
        !(await fsExists(fullpath))
      ) {
        continue;
      }

      for (const lnum of Object.keys(bookmarks)
        .map((l) => Number(l))
        .sort((l1, l2) => l1 - l2)) {
        const bookmark: BookmarkDB.Item = bookmarks[lnum];
        bookmarkNodes.push({
          type: 'child',
          uid: this.helper.getUid(fullpath + ':' + lnum),
          fullpath,
          filename: pathLib.basename(fullpath),
          lnum,
          location: Location.create(fullpath, Range.create(lnum, -1, lnum, -1)),
          line: bookmark.line,
          annotation: bookmark.annotation?.toString(),
        });
      }
    }
    return bookmarkNodes;
  }
}

sourceManager.registerSource('bookmark', BookmarkSource);
