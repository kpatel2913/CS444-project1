import { Errors } from 'cs544-js-utils';

/** Note that errors are documented using the `code` option which must be
 *  returned (the `message` can be any suitable string which describes
 *  the error as specifically as possible).  Whenever possible, the
 *  error should also contain a `widget` option specifying the widget
 *  responsible for the error).
 *
 *  Note also that none of the function implementations should normally
 *  require a sequential scan over all books or patrons.
 */

/******************** Types for Validated Requests *********************/

/** used as an ID for a book */
type ISBN = string; 

/** used as an ID for a library patron */
type PatronId = string;

export type Book = {
  isbn: ISBN;
  title: string;
  authors: string[];
  pages: number;      //must be int > 0
  year: number;       //must be int > 0
  publisher: string;
  nCopies?: number;   //# of copies owned by library; not affected by borrows;
                      //must be int > 0; defaults to 1
};

export type XBook = Required<Book>;

type AddBookReq = Book;
type FindBooksReq = { search: string; };
type ReturnBookReq = { patronId: PatronId; isbn: ISBN; };
type CheckoutBookReq = { patronId: PatronId; isbn: ISBN; };

/************************ Main Implementation **************************/

export function makeLendingLibrary() {
  return new LendingLibrary();
}

export class LendingLibrary {

  /** isbn -> book */
  private books: Map<ISBN, XBook>;

  /** lowercase word -> ISBNs of books whose title or authors contain it */
  private wordIndex: Map<string, Set<ISBN>>;

  /** isbn -> set of patron ids who currently have this book checked out */
  private loans: Map<ISBN, Set<PatronId>>;

  constructor() {
    this.books = new Map();
    this.wordIndex = new Map();
    this.loans = new Map();
  }

  /** Add one-or-more copies of book represented by req to this library.
   *
   *  Errors:
   *    MISSING: one-or-more of the required fields is missing.
   *    BAD_TYPE: one-or-more fields have the incorrect type.
   *    BAD_REQ: other issues like nCopies not a positive integer 
   *             or book is already in library but data in obj is 
   *             inconsistent with the data already present.
   */
  addBook(req: Record<string, any>): Errors.Result<XBook> {
    const validResult = validateBook(req);
    if (!validResult.isOk) return validResult;
    const book = validResult.val;

    const existing = this.books.get(book.isbn);
    if (existing) {
      const badField = findInconsistency(existing, book);
      if (badField) {
        const msg = `"${badField}" does not match existing book ${book.isbn}`;
        return Errors.errResult(msg, 'BAD_REQ', badField);
      }
      existing.nCopies += book.nCopies;
      return Errors.okResult({ ...existing });
    }

    this.books.set(book.isbn, book);
    for (const word of bookWords(book)) {
      let isbns = this.wordIndex.get(word);
      if (!isbns) {
        isbns = new Set();
        this.wordIndex.set(word, isbns);
      }
      isbns.add(book.isbn);
    }
    return Errors.okResult({ ...book });
  }

  /** Return all books matching (case-insensitive) all "words" in
   *  req.search, where a "word" is a max sequence of /\w/ of length > 1.
   *  Returned books should be sorted in ascending order by title.
   *
   *  Errors:
   *    MISSING: search field is missing
   *    BAD_TYPE: search field is not a string.
   *    BAD_REQ: no words in search
   */
  findBooks(req: Record<string, any>) : Errors.Result<XBook[]> {
    const search = req.search;
    if (search === undefined) {
      return Errors.errResult('missing "search" field', 'MISSING', 'search');
    }
    if (typeof search !== 'string') {
      return Errors.errResult('"search" must be a string', 'BAD_TYPE', 'search');
    }
    const words = [...textWords(search)];
    if (words.length === 0) {
      return Errors.errResult('no words in search', 'BAD_REQ', 'search');
    }

    // ISBN set for each search word (empty set if word is unknown),
    // smallest first so the intersection shrinks quickly
    const sets = words.map(w => this.wordIndex.get(w) ?? new Set<ISBN>());
    sets.sort((a, b) => a.size - b.size);

    let matches = sets[0];
    for (const set of sets.slice(1)) {
      matches = new Set([...matches].filter(isbn => set.has(isbn)));
    }

    const books = [...matches].map(isbn => ({ ...this.books.get(isbn)! }));
    books.sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
    return Errors.okResult(books);
  }

  /** Set up patron req.patronId to check out book req.isbn. 
   * 
   *  Errors:
   *    MISSING: patronId or isbn field is missing
   *    BAD_TYPE: patronId or isbn field is not a string.
   *    BAD_REQ error on business rule violation.
   */
  checkoutBook(req: Record<string, any>) : Errors.Result<void> {
    const validResult = validatePatronReq(req);
    if (!validResult.isOk) {
      return validResult;
    }
    const { patronId, isbn } =  validResult.val;
    const book = this.books.get(isbn);
    if (!book) {
      return Errors.errResult(`Unknown book ${isbn}`, 'BAD_REQ', 'isbn');
    }

    const patrons = this.loans.get(isbn) ?? new Set<PatronId>();
    if (patrons.has(patronId)) {
      const msg = `patron ${patronId} already has a book ${isbn} checked out`;
      return Errors.errResult(msg, 'BAD_REQ', 'isbn');
    }

    if (patrons.size >= book.nCopies) {
      const msg = `no copies of book ${isbn} are available  for checkout`;
      return Errors.errResult(msg, 'BAD_REQ', 'isbn');
    }
    
    patrons.add(patronId);
    this.loans.set(isbn, patrons);
    return Errors.VOID_RESULT;

  }

  /** Set up patron req.patronId to returns book req.isbn.
   *  
   *  Errors:
   *    MISSING: patronId or isbn field is missing
   *    BAD_TYPE: patronId or isbn field is not a string.
   *    BAD_REQ error on business rule violation.
   */
  returnBook(req: Record<string, any>) : Errors.Result<void> {
    const validResult = validatePatronReq(req);
    if (!validResult.isOk) return validResult;
    const { patronId, isbn } = validResult.val;

    const patrons = this.loans.get(isbn);

    if (!patrons || !patrons.has(patronId)) {
      const msg = `no checkout of book ${isbn} by patron ${patronId}`;
      return Errors.errResult(msg, 'BAD_REQ', 'isbn');
    }

    patrons.delete(patronId);
    return Errors.VOID_RESULT;
  }
  
}


/********************** Domain Utility Functions ***********************/



const REQUIRED_FIELDS = ['isbn', 'title', 'authors', 'pages', 'year', 'publisher'] as const;
const STRING_FIELDS = ['isbn', 'title', 'publisher'] as const;
const INT_FIELDS = ['pages', 'year', 'nCopies'] as const;

/** Validate req, returning a complete XBook (nCopies defaulted to 1). */
function validateBook(req: Record<string, any>): Errors.Result<XBook> {
  const errors: Errors.Err[] = [];

  // 1. required fields present?
  for (const field of REQUIRED_FIELDS) {
    if (req[field] === undefined) {
      errors.push(makeErr(`missing required field "${field}"`, 'MISSING', field));
    }
  }
  if (errors.length > 0) return new Errors.ErrResult(errors);

  // 2. string fields
  for (const field of STRING_FIELDS) {
    if (typeof req[field] !== 'string') {
      errors.push(makeErr(`"${field}" must be a string`, 'BAD_TYPE', field));
    }
  }

  // 3. numeric fields: must be numbers, then positive integers
  for (const field of INT_FIELDS) {
    const value = req[field];
    if (value === undefined) continue;   // only nCopies can get here undefined
    if (typeof value !== 'number') {
      errors.push(makeErr(`"${field}" must be a number`, 'BAD_TYPE', field));
    }
    else if (!Number.isInteger(value) || value <= 0) {
      errors.push(makeErr(`"${field}" must be an integer > 0`, 'BAD_REQ', field));
    }
  }

  // 4. authors: non-empty array of strings
  const authors = req.authors;
  if (!Array.isArray(authors) || authors.length === 0 ||
      !authors.every(a => typeof a === 'string')) {
    errors.push(makeErr(`"authors" must be a non-empty list of strings`,
                        'BAD_TYPE', 'authors'));
  }

  if (errors.length > 0) return new Errors.ErrResult(errors);

  const book: XBook = {
    isbn: req.isbn,
    title: req.title,
    authors: [...req.authors],
    pages: req.pages,
    year: req.year,
    publisher: req.publisher,
    nCopies: req.nCopies ?? 1,
  };
  return Errors.okResult(book);
}

/** Return the name of the first field where a and b differ, if any. */
function findInconsistency(a: XBook, b: XBook): string | undefined {
  for (const field of ['title', 'pages', 'year', 'publisher'] as const) {
    if (a[field] !== b[field]) return field;
  }
  if (a.authors.length !== b.authors.length ||
      a.authors.some((author, i) => author !== b.authors[i])) {
    return 'authors';
  }
  return undefined;
}

/** All distinct index words in a book's title and authors. */
function bookWords(book: XBook): Set<string> {
  return textWords([book.title, ...book.authors].join(' '));
}

/** Validate req for patron actions (return and checkout), checking patronId and isbn */
function validatePatronReq(req: Record<string, any>): Errors.Result<ReturnBookReq> {

  const errors: Errors.Err[] = [];

  for (const field of ['patronId', 'isbn'] as const) {
    const value = req[field];
    if (value === undefined) {
      errors.push(makeErr(`missing required field "${field}"`, 'MISSING', field));
    }
    else if (typeof value !== 'string'){
      errors.push(makeErr(`""${field}" must be a string`, 'BAD_TYPE', field));
    }
  }

  if (errors.length > 0) return new Errors.ErrResult(errors);
  return Errors.okResult({ patronId: req.patronId, isbn: req.isbn});
}

/********************* General Utility Functions ***********************/


/** Distinct lowercase words (runs of \w with length > 1) in text. */
function textWords(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\w{2,}/g) ?? []);
}

function makeErr(msg: string, code: string, widget: string): Errors.Err {
  return new Errors.Err(msg, { code, widget });
}
