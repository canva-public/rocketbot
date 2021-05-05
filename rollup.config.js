import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  plugins: [
    nodeResolve({
      preferBuiltins: true,
    }),
    typescript(),
    commonjs(),
    json(),
  ],
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'cjs',
  },
  external: ['aws-sdk'],
};
