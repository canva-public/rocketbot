import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';

export default {
  plugins: [
    nodeResolve({
      preferBuiltins: true,
    }),
    typescript(),
  ],
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'cjs',
  },
  external: ['aws-sdk'],
};
