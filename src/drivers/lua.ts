import * as vscode from 'vscode'
import { removeShebang, ParameterPosition, chooseTheMostLikelyFunctionDefinition } from '../utils'

const parser = require('luaparse')

export function getParameterNameList(editor: vscode.TextEditor, languageParameters: ParameterPosition[]): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
        let definition: string = ''
        let definitions: string[]
        const firstParameter = languageParameters[0]
        const description: any = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', editor.document.uri, new vscode.Position(
            firstParameter.expression.line,
            firstParameter.expression.character
        ))
        const shouldHideRedundantAnnotations = vscode.workspace.getConfiguration('inline-parameters').get('hideRedundantAnnotations')
        const luaParameterNameRegex = /^[a-zA-Z_]([0-9a-zA-Z_]+)?/g
    
        if (description && description.length > 0) {
            try {
                const regEx = /^function\ .*\((.*)\)/gm
                definitions = chooseTheMostLikelyFunctionDefinition(<vscode.MarkdownString[]>description[0].contents)?.match(regEx)

                if (!definitions || !definitions[0]) {
                    return reject()
                }

                definition = definitions[0]
            } catch (err) {
                console.error(err)
            }
        }

        const parameters: string[] = definition
            .substring(definition.indexOf('(') + 1, definition.lastIndexOf(')'))
            .replace(/\[/g, '').replace(/\]/g, '')
            .split(',')
            .map(parameter => parameter.trim())
            .map(parameter => {
                const matches = parameter.match(luaParameterNameRegex)
                if (!matches || !matches[0]) {
                    return null
                }

                return matches[0]
            })
            .filter(parameter => parameter)

        parameters.filter((_param, index) => {
            const parameter = languageParameters[index];
            if (parameter === undefined) return false;
            const key = parameter.key;
            const namedValue = parameter.namedValue;

            if (!parameters || !parameters[key]) {
                return false
            }

            let name = parameters[key]

            if (shouldHideRedundantAnnotations && name === namedValue) {
                return false
            }

            return true
        })

        return resolve(parameters);
    })
}

export function parse(code: string): ParameterPosition[][] {
    code = removeShebang(code)
    const ast: any = parser.parse(code, {
        comments: false,
        locations: true,
    })
    const functionCalls: any[] = crawlAst(ast)
    let parameters: ParameterPosition[][] = []

    functionCalls.forEach((expression) => {
        parameters.push(getParametersFromExpression(expression))
    })

    return parameters
}

function crawlAst(ast, functionCalls = []) {
    const canAcceptArguments = ast.type && ast.type === 'CallExpression'
    const hasArguments = ast.arguments && ast.arguments.length > 0
    const shouldHideArgumentNames = vscode.workspace.getConfiguration('inline-parameters').get('hideSingleParameters') && ast.arguments && ast.arguments.length === 1

    if (canAcceptArguments && hasArguments && !shouldHideArgumentNames) {
        functionCalls.push(ast)
    }

    for (const [key, value] of Object.entries(ast)) {
        if (key === 'comments') {
            continue
        }

        if (value instanceof Object) {
            functionCalls = crawlAst(value, functionCalls)
        }
    }

    return functionCalls
}

function getParametersFromExpression(expression: any): ParameterPosition[] | undefined {
    if (!expression.arguments) {
        return undefined;
    }

    let parameters = [];

    expression.arguments.forEach((argument: any, key: number) => {
        parameters.push({
            namedValue: argument.name ?? null,
            expression: {
                line: parseInt(expression.base.identifier.loc.start.line) - 1,
                character: parseInt(expression.base.identifier.loc.start.column),
            },
            key: key,
            start: {
                line: parseInt(argument.loc.start.line) - 1,
                character: parseInt(argument.loc.start.column),
            },
            end: {
                line: parseInt(argument.loc.end.line) - 1,
                character: parseInt(argument.loc.end.column),
            },
        })
    })

    return parameters
}
