> "Nétwayé, baléyé, astiké  
> Kaz la toujou penpan  
> Ba’w manjé, baw lanmou  
> E pou vou an ka fèy an chantan"
>
> "Cleaning, Sweeping, Polishing  
> Your home is always clean  
> I cook for you, I give you love  
> Singing along just for you"
>
> [Maldòn by Zouk Machine](http://www.youtube.com/watch?v=BPdrGOFXzGA)


# Hook Machine

The Hook Machine runs shell scripts in given Git repositories in response to `git push` events sent to GitHub and/or changes in some external condition checked once in a while. 

The Hook Machine is typically aimed at automating the deployment of one or more Git repositories to some final server but may also be used to run scripts that do **not** deploy anything (test runners, email sending, whatever).

The Hook Machine is useful if:

1. you have a **Git repository** available on GitHub, be them public or private. Other Git hosting services might work as well, they are just untested at this point;
2. your Git repository contains **shell scripts** that automate the deployment to some final server, or some other task that you would like to run on the code of the repo;
3. you would like to deploy the repository **whenever someone issues a `git push` command on some branch**;
4. you would like to deploy the repository **whenever some external condition changes**, for instance because the repo fetches some of its contents from the cloud and needs to be updated when that content changes.

If all points hold, you may want to install the Hook Machine on some server of your own! If you do not need periodic checks (point 4. above), that may not be worth the hassle. Check the [concrete example](#a-concrete-example) section near the end of this text for a typical usage scenario.

The Hook Machine is a [Node.js](http://nodejs.org/) application that includes:

- a **Web server** that listens to `git push` events received from GitHub through [Post-receive hooks](https://help.github.com/articles/post-receive-hooks) and runs a shell script in some Git repository accordingly;
- a **periodic loop** that runs shell scripts in Git repositories to detect changes in some condition and reacts based on the result;
- a **local file cache** for cloned Git repositories;
- a simple **file queue mechanism** to run tasks sequentially in the background.

The Hook Machine can typically be installed on [Heroku](http://heroku.com/) but any other not-too-old Linux-based environment where [Node.js](http://nodejs.org/) is installed should work.


## Install and run

To install and run the Hook Machine, run the following commands:

```
git clone git@github.com:joshfire/hookmachine.git
cd hookmachine
npm install
export HOOKMACHINE_POST_RECEIVE_HOOKS="{}"
export HOOKMACHINE_PERIODIC_HOOKS="{}"
export HOOKMACHINE_HOOK_SECRET="somesecret"
export HOOKMACHINE_KEY_MAIN="some private SSH key"
npm start
```

Check the [Configuration](#configuration) section below to set the above variables accordingly.

Once the Hook Machine is up and running, set the WebHook URL of Git repositories that the Hook Machine should manage on GitHub to `[Hook Machine HTTP address]/github/callback?secret=[HOOK_SECRET]` and start pushing.


## Configuration

### Local configuration and environment variables

The server reads its configuration from the `config.defaults.json` file. In particular, the file describes the post-receive hooks that the server listens to and the periodic actions that the server runs.

If the folder contains a `config.json` file, its variables will replace those of the `config.defaults.json` file. The `config.json` file is git-ignored.

Also, for each resulting setting, if the environment contains a variable with the same name prefixed with `HOOKMACHINE_`, then its value is used. For instance, to override the hook secret used between GitHub and the Hook Machine (the `HOOK_SECRET` setting, you may use:

```
export HOOKMACHINE_HOOK_SECRET="SuperSecret"
```

Or, if you are deploying the Hook Machine on Heroku:

```
heroku config:set HOOKMACHINE_HOOK_SECRET="SuperSecret"
```


### GitHub post-receive hooks

The server checks the `POST_RECEIVE_HOOKS` configuration setting to gather the list of post-receive hooks it listens to. Each hook is defined by the name of the repository and the Git `ref`, typically `refs/heads/master` to listen on pushes made to the `master` branch.

The example below listens to pushes made to the `master` branch of the `joshfire.com` repository. When it receives one, it clones the Git repository defined in `origin` and runs the provided `script` in that repository:

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

Notes:

- The name of the hook is intended for humans and logging purpose and does not need to follow any particular format.
- Obviously, the post-receive hook must be enabled through a WebHook URL in the settings of the repository in GitHub.


### Periodic hooks

The server checks the `PERIODIC_HOOKS` configuration setting to gather the list of scripts to run periodically. Each hook simply defines the action to run.

The example below runs the `tools/checkfeeds.sh` script of the repository identified by the specified Git origin. If that script exits with status code `42`, the `tools/build.sh` script is run.


```json
{
  "PERIODIC_HOOKS": {
    "joshfire.com": {
      "origin": "git@github.com:joshfire/joshfire.com.git",
      "check": "tools/checkfeeds.sh",
      "script": "tools/build.sh"
    }
  }
}
```

The name of the hook is intended for humans and logging purpose and does not need to follow any particular format.


### Git actions

Each hook describes an action to perform, defined by the following properties:

- `origin` (required): the Git origin of the repository to clone.
- `script` (required): the relative path to the script to run, starting from the root folder of the repository. The script is always run in the absence of a `check` property. It is run if the `check` script exists with code `42` otherwise.
- `privatekey` (optional): the name of the configuration setting that contains the private SSH key to use in Git operations. If not provided, the Hook Machine will use the value of the `KEY_MAIN` setting. This mechanism lets you use more than one private SSH key if needed. Note that all private keys must start with `KEY_` to be correctly picked up as private SSH keys by the server at startup.
- `branch` (optional): the branch to checkout, `master` if not provided.
- `check` (optional): the relative path to the script to run to detect changes. If the script returns with an exit code `42`, the script targeted by the `script` property is run. Nothing happens otherwise.
- `env` (optional): an object that describes additional environment variables to pass to the scripts to run.


### Credentials

#### Private SSH key

The Hook Machine will typically pull/push private Git repositories to different remotes and thus needs to have the appropriate permissions on these repositories. The machine will run all Git commands using the contents of the `KEY_MAIN` setting as private SSH key.

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

It is also good practice to make sure that only GitHub sends hooks requests to your Hook Machine. To do that:

1. use HTTPS (Heroku exposes a free [SSL endpoint](https://devcenter.heroku.com/articles/ssl-endpoint) for instance)
2. set the `HOOK_SECRET` setting to some secret of your own
3. set the WebHook URL on GitHub to `[DEPLOY_MACHINE]/github/callback?secret=[HOOK_SECRET]`.


### Other configuration settings

#### Git user

Git pull/push commands will be done on behalf of *someone*. That someone is defined by the `GIT_USERNAME` and `GIT_USEREMAIL` configuration settings. Default values are `Hook Machine` and `hook.machine@example.com`.

#### HTTP port

The HTTP port that the Web server listens to is defined by the `PORT` variable. Note that the Hook Machine will use the value of the `PORT` environment variable (as opposed to that of the `HOOKMACHINE_PORT` environment variable) and is thus compatible with Heroku.

#### Periodic interval

The `PERIODIC_INTERVAL` configuration setting sets the interval between two runs of the periodic loop, in seconds. It is set to `1200` by default, meaning the periodic loop is run once every 20 minutes.

#### Data folder

The `DATA_FOLDER` configuration setting sets the folder used to store cloned repositories and messages of the file queue. The machine stores things in the `data` folder by default.

#### Log settings

The Hook Machine uses [Woodman](http://joshfire.github.io/woodman/) to trace execution. Things get reported to the console by default. Set the `WOODMAN` configuration setting to a valid [Woodman configuration object](http://joshfire.github.io/woodman/config.html) to adjust logs to your liking.

## Development

### Architecture

The Hook Machine is composed of:

- a Web server that listens to incoming POST requests from GitHub. Internally, the code uses the [node-github-hook](https://github.com/nlf/node-github-hook/) module under an MIT license.
- a daemon that runs scripts periodically (once every 20 minutes by default), using a simple `setInterval` loop.
- a simple task queue that processes tasks one after the other. The task queue uses the file system to manage tasks and a simple in-memory mutex to prevent concurrency issues.

### The `data` folder

The Hook Machine uses the file system to store things, in the `data` folder by default. After a few runs, this `data` folder should contain:

- a `deploykeys` folder that contains the private SSH keys defined in the configuration and stored as files with the appropriate permissions
- a `repositories` folder that contains clones of the repositories that had to be cloned
- a `tasks` folder that contains the tasks that are either pending, running or processed by the server.

### Dependencies

As many other projects, the Hook Machine depends on a few external libraries, listed in `package.json` and installed with a call to `npm install`. Perhaps more surprisingly, note that `npm` is actually explicitly listed as a dependency. Do not remove it, that's on purpose!

This is meant for environments such as Heroku that do not expose the `npm` utility once the deploy is over. In practice, the Hook Machine needs to clone Git repositories once in a while and needs to run `npm install` on the result. Hence the dependency to force the installation of `npm` during the deploy. The `gitaction.sh` file targets `node_modules/.bin/npm` when it needs to issue NPM commands.

### Logs

The Hook Machine uses [Woodman](http://joshfire.github.io/woodman/) to send logs to the console (override the `WOODMAN` setting to change Woodman's configuration), reporting errors as they occur.

### Deployment to Heroku

The Hook Machine should run fine on Heroku... provided the Web dyno the Hook Machine is deployed never switched to idle. In particular, while the Hook Machine follows a very usual approach of running long-lasting tasks in the background, it is implemented as an all-in-one machine that does not fit [Heroku's process model](https://devcenter.heroku.com/articles/background-jobs-queueing) for background jobs.

To be more Heroku-friendly, the Hook Machine would run a Web dyno that listens to requests from GitHub, a Worker dyno that runs the tasks, a scheduler that schedules check tasks once in a while (the [Heroku Scheduler](https://addons.heroku.com/scheduler) add-on would do the trick) and some message queue to pass the tasks around between dynos (e.g. [CloudAMQP](https://addons.heroku.com/cloudamqp)). This is extremely scalable but seems overly complex for a machine that does not really need to scale in practice and that should remain easy to deploy and monitor in other environments, typically on a local machine.


## A concrete example

Here is a concrete example of how we use the Hook Machine at Joshfire to automate the deployment of the main [Joshfire.com](http://joshfire.com) Web site.

The Web site of Joshfire is assembled from different components:

- HTML pages are assembled from [EJS](http://embeddedjs.com/) templates
- CSS styles are created from [SASS](http://sass-lang.com/) files
- blog posts are extracted from Tumblr
- home page slides are defined in a Google Spreadsheet
- the list of persons in the team as well
- and so on, the point being that data feeds are not *part of* the Web site but are retrieved from third-party content providers.

While the Web site needs to be updated whenever some template changes or whenever a new blog post is written, there is nothing inherently *dynamic* here. In practice, to keep the Web server as simple as possible, a series of [Grunt](http://gruntjs.com/) tasks simply create a *static* build of the Web site and that build is published to our Web server.

In terms of Git workflow, changes are committed to the `dev` branch and released to the `master` branch once a new version is ready to ship. Builds are created from the `master` branch and from an export of the data feeds (Tumblr, Google Spreadsheets, Flickr, etc.). To be able to rollback to a previous version of the Web site easily, builds are kept in a `build` branch. This is all done through a series of simple shell scripts:

- `release.sh` releases the `dev` branch to `master`
- `build.sh` builds a new version of the Web site
- `publish.sh` pushes the latest build to the Web server
- `checkfeeds.sh` checks whether feeds have been updated

The contents of these scripts does not matter here. A typical script runs a bunch of Grunt, HTTP and Git commands. What matters is that the site needs to be updated after a call to `release.sh` and whenever `checkfeeds.sh` signals that feeds have been updated. This is precisely where the Hook Machine comes into play!

The Hook Machine reacts to the `git push origin master` command sent at the end of the `release.sh` script and runs `build.sh` accordingly. In turn, the Hook Machine reacts to the `git push origin build` command sent at the end of the `build.sh` script and runs `publish.sh` accordingly. In parallel, the Hook Machine runs `checkfeeds.sh` periodically to detect feed updates and runs `build.sh` when feeds have been updated (which in turn triggers a `git push origin build` and so on). This is illustrated in the following simplified sequence diagram:

![Deploy sequence that shows how the Hook Machine reacts to changes made to the components of the Web site](media/sequence.png)

The following Hook Machine configuration sets the two GitHub post-receive hooks and the periodic hook:

```json
{
  "POST_RECEIVE_HOOKS": {
    "build joshfire.com": {
      "reponame": "joshfire.com",
      "ref": "refs/heads/master",
      "action": {
        "origin": "git@github.com:joshfire/joshfire.com.git",
        "script": "tools/build.sh"
      }
    },
    "publish joshfire.com": {
      "reponame": "joshfire.com",
      "ref": "refs/heads/build",
      "action": {
        "origin": "git@github.com:joshfire/joshfire.com.git",
        "script": "tools/publish.sh"
      }
    }
  },
  "PERIODIC_HOOKS": {
    "check joshfire.com": {
      "origin": "git@github.com:joshfire/joshfire.com.git",
      "check": "tools/checkfeeds.sh",
      "script": "tools/build.sh"
    }
  }
}
```


## Security considerations

Automating the publication of something is a good idea... until someone hits the wrong button by mistake and triggers the deployment of code and content that was not meant to be deployed. There is no easy way in Git to manage permissions per branch. Said differently, you cannot easily give push permissions to someone on a `dev` branch but not on `master`.

Use the Hook Machine with care!


## License

The Hook Machine is licensed under the [MIT license](https://raw.github.com/joshfire/hookmachine/master/LICENSE). Copyright (c) 2013 Joshfire. All rights reserved.

The Hook Machine uses the following open-source libraries:

- [Almond](https://github.com/jrburke/almond). Copyright (c) 2011-2012, The Dojo Foundation All Rights Reserved. [New BSD or MIT licensed](https://github.com/jrburke/almond/blob/master/LICENSE)
- [Async.js](https://github.com/caolan/async). Copyright (c) 2010 Caolan McMahon, [MIT licensed](https://github.com/caolan/async/master/LICENSE)
- [node-github-hook](https://github.com/nlf/node-github-hook/). Programmed by Nathan LaFreniere, Copyright (c) 2012, [MIT licensed](https://github.com/nlf/node-github-hook/blob/master/LICENSE)
- [mkdirp](https://github.com/substack/node-mkdirp). Copyright 2010 James Halliday (mail@substack.net), [MIT licensed](https://github.com/substack/node-mkdirp/blob/master/LICENSE)
- [node-uuid](https://github.com/broofa/node-uuid). Copyright (c) 2010-2012 Robert Kieffer, [MIT licensed](https://github.com/broofa/node-uuid/blob/master/LICENSE.md)
- [npm](https://github.com/isaacs/npm). Copyright (c) Isaac Z. Schlueter. All rights reserved. Released under the [Artistic License 2.0](https://github.com/isaacs/npm/blob/master/LICENSE)
- [Underscore](http://underscorejs.org/). Copyright (c) 2009-2013 Jeremy Ashkenas, DocumentCloud Inc. MIT licensed
- [Woodman](http://joshfire.github.io/woodman/). Copyright (c) 2013 Joshfire, all rights reserved, [MIT licensed](http://joshfire.github.io/woodman/about.html#license)