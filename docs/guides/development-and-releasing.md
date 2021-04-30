# Development and releasing

In this guide you'll learn how to develop and release new versions of RocketBot.

## Development

You need to run RocketBot with the version of Node.js that Lambda supports. Currently this is 12.x and 14.x, so use a Node.js version manager. For example,

```bash
yarn global add n
n 12
```

Then you can run your tests as usual using `yarn test`, or run them in watch mode using `yarn test:watch`.

### Debugging hints

Use `ENABLE_DEBUG=true DEBUG=nock.* yarn test:watch` and `.only` in your tests to see output and assertions from nock.

## Releasing

Tag your commit using the pattern `vX.X.X`, where `X.X.X` is the new to-be-released semantic version of the package. This creates a new release and attaches a zip file to it. Please add as much detail as possible to the release description.
