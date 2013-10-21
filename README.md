# The Git Deploy Machine

The deploy machine is a Web server that listens to push events received from GitHub through [Post-receive hooks](https://help.github.com/articles/post-receive-hooks) and/or detects changes to some condition periodically and runs some Git related deploy action accordingly.

Typical use cases for the deploy machine are to automate the deployment of an application when:

1. a `git push` command is issued on the `master` branch
2. the feeds of data that compose the application change

The deploy machine is actually fairly generic and could run actions that do not *deploy* anything. The original intent is for deployment purpose though.


## Install and run

To install and run the deploy machine locally, run the following commands:

```
git clone git@github.com:joshfire/deploymachine.git
cd deploymachine
npm install
export DEPLOYMACHINE_KEY_MAIN="the private SSH key"
npm start
```

Note that you need to set the `DEPLOYMACHINE_KEY_MAIN` variable to the contents of the private SSH key allowed to pull/push to the Git server(s) used within the scripts before you may run the server. For obvious security reasons, credentials are not part of the repository.


## Configuration

### Local configuration and environment variables

The server reads its configuration from the `config.defaults.json` file. In particular, the file describes the post-receive hooks that the server listens to and the periodic actions that the server runs.

If the folder contains a `config.json` file, its variables will replace those of the `config.defaults.json` file.

Also, for each resulting setting, if the environment contains a variable with the same name prefixed with `DEPLOYMACHINE_`, then its value is used. For instance, to override the hook secret used between GitHub and the Web server of the deploy machine (the `HOOK_SECRET` setting, you may use:

```
export DEPLOYMACHINE_HOOK_SECRET="SuperSecret"
```

Or, if you are deploying the deploy machine on Heroku:

```
heroku config:set DEPLOYMACHINE_HOOK_SECRET="SuperSecret"
```


### GitHub post-receive hooks

The server checks the `POST_RECEIVE_HOOKS` configuration setting to gather the list of post-receive hooks it listens to. Each hook is defined by the name of the repository (as it appears in the `name` property of its `package.json`) and the Git `ref`, typically `refs/heads/master` to listen on pushes made to the `master` branch.

The example below listens to pushes made to the `master` branch of the `joshfire.com` repository and runs the `tools/build.sh` script of the repository identified by the specified Git origin when that happens:

```json
{
  "POST_RECEIVE_HOOKS": {
    "joshfire.com/build": {
      "reponame": "joshfire.com",
      "ref": "refs/heads/master",
      "action": {
        "origin": "git@github.com:joshfire/joshfire.com.git",
        "script": "tools/build.sh"
      }
    }
  }
}
```

The name of the hook is intended for humans and logging purpose and does not need to follow any particular format.

Obviously, the post-receive hook must be enabled in the settings of the repository in GitHub. Note the server listens on `/github/callback`.


### Periodic hooks

The server checks the `PERIODIC_HOOKS` configuration setting to gather the list of scripts to run periodically. Each hook simply defines the action to run.

The example below runs the `tools/updatefeeds.sh` script of the repository identified by the specified Git origin. If that script exits with status code `42`, the `tools/build.sh` script is run.


```json
{
  "PERIODIC_HOOKS": {
    "joshfire.com": {
      "origin": "git@github.com:joshfire/joshfire.com.git",
      "check": "tools/updatefeeds.sh",
      "script": "tools/build.sh"
    }
  }
}
```

The name of the hook is intended for humans and logging purpose and does not need to follow any particular format.

### Git actions

Each hook describes an action to perform, defined by the following properties:

- `origin` (required): the Git origin of the repository to clone.
- `script` (required): the relative path to the script to run, starting from the root folder of the repository. The script is always run in the absence of a `check` property. It is run depending on the exit status of the `check` script otherwise.
- `privatekey` (optional): the name of the configuration setting that contains the private SSH key to use in Git operations. If not provided, the deploy machine will use the value of the `KEY_MAIN` setting. This mechanism lets you use more than one private SSH key if needed. Note that all private keys must start with `KEY_` to be correctly picked up as private SSH keys by the server at startup.
- `branch` (optional): the branch to checkout, `master` if not provided
- `check` (optional): the relative path to the script to run to detect changes. If the script returns with an exit code `42`, the script targeted by the `script` property is run. Nothing happens otherwise.
- `env` (optional): an object that describes additional environment variables to pass to the scripts to run.


### Credentials

#### Private SSH key

The deploy machine will typically pull/push private Git repositories to different remotes and thus needs to have the appropriate permissions on these repositories. The machine will run all Git commands using the contents of the `KEY_MAIN` setting as private SSH key.

```
-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAtC43wJqWRgTxhTBisheu98bWVuLvVc+grwcRtThmYJuBSVJN
[...]
p986S9O7BGbJuKqQqgrWoPvpYVnIzlIrFw6tAwZftmWfBPxR3N0=
-----END RSA PRIVATE KEY-----
```

**Note:** In GitHub, deploy keys can be associated with only one repo. If you need to use the same key for multiple repositories, use a [machine user](https://help.github.com/articles/managing-deploy-keys#machine-users).

To test things locally, you may create a `config.json` file (ignored by Git) that contains the private SSH key to use (note the `\n` for carriage returns):

```json
{
  "KEY_MAIN": "-----BEGIN RSA PRIVATE KEY-----\n[...]\n-----END RSA PRIVATE KEY-----"
}
```

#### Hook secret

It is also good practice to make sure that only GitHub sends hooks requests to your deploy machine. To do that:

1. use HTTPS (Heroku exposes a free [SSL endpoint](https://devcenter.heroku.com/articles/ssl-endpoint) for instance)
2. set the `HOOK_SECRET` setting to some secret of your own
3. set the WebHook URL on GitHub to `[DEPLOY_MACHINE]/github/callback?secret=[HOOK_SECRET]`.


## Development

### Architecture

The deploy machine is composed of:

- a Web server that listens to incoming POST requests from GitHub. Internally, the code uses the [node-github-hook](https://github.com/nlf/node-github-hook/) module, MIT license.
- a daemon that runs scripts periodically (once every 20 minutes by default), using a simple `setInterval` loop.
- a task queue that processes tasks one after the other. The task queue uses the file system to manage tasks and a simple mutex in memory to handle concurrency issues. The task queue is directly taken from the code of the [Windows 8 application build machine repo](https://github.com/joshfire/factory-worker-windows8-build), only very slightly generalized for the deploy machine.

### The `data` folder

The deploy machine uses the file system to store things, in the `data` folder by default. After a few runs, this `data` folder should contain:

- a `deploykeys` folder that contains the private SSH keys defined in the configuration and stored as files with the appropriate permissions
- a `repositories` folder that contains clones of the repositories that had to be cloned
- a `tasks` folder that contains the tasks that are either pending, running or processed by the server.

### Dependencies

As many other projects, the deploy machine depends on a few external libraries, listed in `package.json` and installed with a call to `npm install`. Perhaps more surprisingly, note that `npm` is actually explicitly listed as a dependency. Do not remove it, that's on purpose!

This is meant for environments such as Heroku that do not expose the `npm` utility once the deploy is over. In practice, the deploy machine needs to clone Git repositories once in a while and needs to run `npm install` on the result. Hence the dependency to force the installation of `npm` during the deploy. The `gitaction.sh` file targets `node_modules/.bin/npm` when it needs to issue NPM commands.

### Logs

The deploy machine uses [Woodman](http://joshfire.github.io/woodman/) to send logs to the console (override the `WOODMAN` setting to change Woodman's configuration), reporting errors as they occur.

## License

Copyright (c) 2013 Joshfire. All rights reserved.
