#! /usr/bin/env node
/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements the texture compiler process. The texture compiler
/// script calls out to native code to perform most of the actual image
/// processing.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem        = require('fs');
var Path              = require('path');
var Program           = require('commander');
var DataCompiler      = require('datacompiler');
var TextureCompiler   = require('../index');

/// Constants and global values used throughout the application module.
var application       = {
    /// The name of the application module.
    NAME              : 'texture',
    /// The path from which the application was started.
    STARTUP_DIRECTORY : process.cwd(),
    /// An object defining the pre-digested command-line arguments passed to
    /// the application, not including the node or script name values.
    args              : {},
    /// The data compiler version number.
    version           : 1,
};

/// Constants representing the various application exit codes.
var exit_code         = {
    /// The program has exited successfully.
    SUCCESS           : 0,
    /// The program has exited with an unknown error.
    ERROR             : 1,
    /// The program has exited because the source file does not exist.
    FILE_NOT_FOUND    : 2
};

/// Processes any options specified on the command line. If necessary, help
/// information is displayed and the application exits.
/// @return An object whose properties are the configuration specified by the
/// command-line arguments, with suitable defaults filled in where necessary.
function command_line()
{
    // parse the command line, display help, etc. if the command
    // line is invalid, commander will call process.exit() for us.
    Program
        .version('1.0.0')
        .option('-P, --persistent',    'Start in persistent mode.',          Boolean, false)
        .option('-i, --input [path]',  'Specify the source file.',           String, '')
        .option('-o, --output [path]', 'Specify the destination file.',      String, '')
        .option('-t, --target [name]', 'Specify the build target platform.', String, '')
        .parse(process.argv);

    if (Program.persistent)
    {
        // when running in persistent mode, command-line arguments are ignored.
        return {
            persistent : true,
            sourcePath : process.argv[1],
            targetPath : process.argv[1],
            platform   : ''
        };
    }

    // when running in command-line mode, we have additional work to do.
    if (!DataCompiler.isFile(Program.input))
    {
        console.log('Error: No input file specified or input file not found.');
        console.log();
        process.exit(exit_code.FILE_NOT_FOUND);
    }
    if (!Program.output)
    {
        var file       = Path.basename(Program.input);
        var path       = process.cwd();
        file           = DataCompiler.changeExtension(file, 'pixels');
        Program.output = Path.join(path, file);
    }
    return {
        persistent : false,
        sourcePath : Program.input,
        targetPath : Program.output,
        platform   : Program.target
    };
}

/// Writes a JSON document specifying texture metadata to disk.
/// @param path The path and filename of the target file.
/// @param meta An object specifying texture metadata.
function write_texture_metadata(path, meta)
{
    var json = JSON.stringify(meta, null, '\t')+'\n';
    Filesystem.writeFileSync(path, json, 'utf8');
}

/// Implements the build process for the data compiler.
/// @param input An object describing the build environment.
/// @param input.sourcePath The path of the input source file.
/// @param input.targetPath The path of the target resource, without extension.
/// @param input.platform The name of the current build target.
/// @param input.isIPC Should be true if the build was triggered via IPC.
function compiler_build(input)
{
    var state  = DataCompiler.startBuild(input);
    var rinfo  = DataCompiler.parseResourcePath(input.sourcePath);
    var mpath  = DataCompiler.changeExtension(input.targetPath, 'texture');
    var ppath  = input.targetPath;
    try
    {
        var md = TextureCompiler.compile({
            sourcePath          : input.sourcePath,
            targetPath          : input.targetPath,
            type                : 'COLOR',
            format              : 'RGB',
            target              : 'TEXTURE_2D',
            wrapModeS           : 'CLAMP_TO_EDGE',
            wrapModeT           : 'CLAMP_TO_EDGE',
            minifyFilter        : 'LINEAR',
            magnifyFilter       : 'LINEAR',
            borderMode          : 'CLAMP',
            premultipliedAlpha  : false,
            forcePowerOfTwo     : false,
            flipY               : true,
            buildMipmaps        : false,
            levelCount          : 0,
            targetWidth         : 0,
            targetHeight        : 0,
        });
        write_texture_metadata(mpath, md);
        // add the successfully generated output files.
        state.addOutput(mpath);
        state.addOutput(ppath);
    }
    catch (error)
    {
        // add the error; build will be unsuccessful.
        state.addError(error);
        // when running stand-alone, output the error so the user knows
        // that something went wrong. in persistent mode, the error is
        // output for us by the build system.
        if (!application.args.persistent)
        {
            console.error('An error has occurred:');
            console.error('  '+error);
            console.error();
            process.exit(exit_code.ERROR);
        }
    }
    DataCompiler.finishBuild(state);
}

/// Override the default DataCompiler implementation to return the correct
/// version of our data compiler.
/// @return A Number specifying the current data compiler version.
DataCompiler.queryCompilerVersion = function ()
{
    return application.version;
};

/// Handles the DataCompiler build event, emitted when a build is triggered
/// via an IPC mechanism.
/// @param data Data associated with the build request.
/// @param data.sourcePath The absolute path of the input source file.
/// @param data.targetPath The absolute path of the target resource, not
/// including the file extension (resource type).
/// @param data.platform The name of the current build target. An empty string
/// or the string 'generic' indicates a platform-agnostic build.
DataCompiler.on('build', function (data)
{
    compiler_build({
        sourcePath : data.sourcePath,
        targetPath : data.targetPath,
        platform   : data.platform,
        isIPC      : true
    });
});

/// Catches any unhandled exceptions that occur during execution.
/// @param error An Error instance specifying additional information.
process.on('unhandledException', function (error)
{
    console.error('An unhandled exception has occurred:');
    console.error('  Error: '+error);
    console.error();
    process.exit(exit_code.ERROR);
});

/// Handles the SIGTERM signal that may be sent to the process. The process
/// terminates immediately, returning a success code.
process.on('SIGTERM', function ()
{
    process.exit(exit_code.SUCCESS);
});

/// Handles the SIGINT signal that may be sent to the process. The process
/// terminates immediately, returning a success code.
process.on('SIGINT', function ()
{
    process.exit(exit_code.SUCCESS);
});

/// Implements and executes the entry point of the command-line application.
var main = (function Main()
{
    application.args = command_line();
    var ipcMode      = application.args.persistent;
    if (ipcMode    === false)
    {
        compiler_build({
            sourcePath : application.args.sourcePath,
            targetPath : application.args.targetPath,
            platform   : application.args.platform,
            isIPC      : false
        });
    }
}());
