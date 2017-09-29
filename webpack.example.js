var TsConfigPathsPlugin = require('awesome-typescript-loader').TsConfigPathsPlugin;
const webpack = require('webpack');
const path = require('path');

module.exports = {
    devtool: 'inline-source-map',
    entry: './example/example.ts',
    resolve: {
        extensions: ['.ts', '.js'],
        plugins: [new TsConfigPathsPlugin()]
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'awesome-typescript-loader'
            },
            {
                enforce: 'pre',
                test: /\.js$/,
                loader: 'source-map-loader'
            }
        ]
    },
    plugins: [
        new webpack.LoaderOptionsPlugin({
            minimize: false,
            debug: true
        })
    ],
    output: {
        filename: 'example.js',
        path: path.join(__dirname, 'example')
    }
};
