export type TestFilterExpression =
    | { kind: 'term'; value: string }
    | { kind: 'and'; left: TestFilterExpression; right: TestFilterExpression }
    | { kind: 'or'; left: TestFilterExpression; right: TestFilterExpression };

type TokenKind = 'term' | 'and' | 'or' | 'lparen' | 'rparen';

interface Token {
    readonly kind: TokenKind;
    readonly value: string;
}

export function parseFilterExpression(input: string): TestFilterExpression | undefined {
    const tokens = tokenize(input);
    if (tokens.length === 0) {
        return undefined;
    }
    const parser = new Parser(tokens);
    const expression = parser.parseExpression();
    if (!expression || !parser.isAtEnd()) {
        throw new Error('Invalid filter expression');
    }
    return expression;
}

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (ch === '(') {
            tokens.push({ kind: 'lparen', value: ch });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ kind: 'rparen', value: ch });
            i++;
            continue;
        }
        if (ch === ',') {
            tokens.push({ kind: 'and', value: ch });
            i++;
            continue;
        }
        if (input.startsWith('&&', i)) {
            tokens.push({ kind: 'and', value: '&&' });
            i += 2;
            continue;
        }
        if (input.startsWith('||', i)) {
            tokens.push({ kind: 'or', value: '||' });
            i += 2;
            continue;
        }

        let end = i;
        let inQuotes = false;
        while (
            end < input.length
            && (inQuotes || (
                !/\s/.test(input[end])
                && input[end] !== '('
                && input[end] !== ')'
                && input[end] !== ','
            ))
        ) {
            if (input[end] === '"' && input[end - 1] !== '\\') {
                inQuotes = !inQuotes;
            }
            end++;
        }
        const value = input.substring(i, end);
        const upper = value.toUpperCase();
        if (upper === 'AND') {
            tokens.push({ kind: 'and', value });
        } else if (upper === 'OR') {
            tokens.push({ kind: 'or', value });
        } else {
            tokens.push({ kind: 'term', value });
        }
        i = end;
    }
    return tokens;
}

class Parser {
    private index = 0;

    constructor(private readonly tokens: readonly Token[]) {}

    isAtEnd(): boolean {
        return this.index >= this.tokens.length;
    }

    parseExpression(): TestFilterExpression | undefined {
        return this.parseOr();
    }

    private parseOr(): TestFilterExpression | undefined {
        let expr = this.parseAnd();
        while (expr && this.match('or')) {
            const right = this.parseAnd();
            if (!right) { throw new Error('Missing right side of OR'); }
            expr = { kind: 'or', left: expr, right };
        }
        return expr;
    }

    private parseAnd(): TestFilterExpression | undefined {
        let expr = this.parsePrimary();
        while (expr && this.match('and')) {
            const right = this.parsePrimary();
            if (!right) { throw new Error('Missing right side of AND'); }
            expr = { kind: 'and', left: expr, right };
        }
        return expr;
    }

    private parsePrimary(): TestFilterExpression | undefined {
        if (this.match('term')) {
            return { kind: 'term', value: this.previous().value };
        }
        if (this.match('lparen')) {
            const expr = this.parseExpression();
            if (!expr || !this.match('rparen')) {
                throw new Error('Unclosed group');
            }
            return expr;
        }
        return undefined;
    }

    private match(kind: TokenKind): boolean {
        if (this.peek()?.kind !== kind) {
            return false;
        }
        this.index++;
        return true;
    }

    private peek(): Token | undefined {
        return this.tokens[this.index];
    }

    private previous(): Token {
        return this.tokens[this.index - 1];
    }
}
