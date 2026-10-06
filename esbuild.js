// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const ctx = await esbuild.context({
        entryPoints: {
            extension: 'src/extension.ts',
            cli: 'src/cli.ts',
            'mcp-server': 'src/mcpServer.ts',
        },
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outdir: 'dist',
        external: ['vscode'],
        logLevel: 'warning',
    });

    if (watch) {
        await ctx.watch();
        console.log('[esbuild] watching...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        console.log(`[esbuild] build complete (${production ? 'production' : 'development'})`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
