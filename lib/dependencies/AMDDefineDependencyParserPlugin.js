/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
var AbstractPlugin = require("../AbstractPlugin");
var AMDRequireItemDependency = require("./AMDRequireItemDependency");
var AMDRequireContextDependency = require("./AMDRequireContextDependency");
var ConstDependency = require("./ConstDependency");
var AMDDefineDependency = require("./AMDDefineDependency");
var ContextDependencyHelpers = require("./ContextDependencyHelpers");

function isBoundFunctionExpression(expr) {
	if(expr.type !== "CallExpression") return false;
	if(expr.callee.type !== "MemberExpression") return false;
	if(expr.callee.computed) return false;
	if(expr.callee.object.type !== "FunctionExpression") return false;
	if(expr.callee.property.type !== "Identifier") return false;
	if(expr.callee.property.name !== "bind") return false;
	return true;
}

module.exports = AbstractPlugin.create({
	"call define": function(expr) {
		var array, fn, obj;
		switch(expr.arguments.length) {
		case 1:
			if(expr.arguments[0].type == "FunctionExpression" || isBoundFunctionExpression(expr.arguments[0])) {
				// define(f() {...})
				fn = expr.arguments[0];
			} else if(expr.arguments[0].type === "ObjectExpression") {
				// define({...})
				obj = expr.arguments[0];
			} else {
				// define(expr)
				// unclear if function or object
				obj = fn = expr.arguments[0];
			}
			break;
		case 2:
			if(expr.arguments[0].type === "Literal") {
				// define("...", ...)
				if(expr.arguments[1].type === "FunctionExpression" || isBoundFunctionExpression(expr.arguments[0])) {
					// define("...", f() {...})
					fn = expr.arguments[1];
				} else if(expr.arguments[1].type === "ObjectExpression") {
					// define("...", {...})
					obj = expr.arguments[1];
				} else {
					// define("...", expr)
					// unclear if function or object
					obj = fn = expr.arguments[1];
				}
			} else {
				// define([...], f() {})
				array = expr.arguments[0];
				fn = expr.arguments[1];
			}
			break;
		case 3:
			// define("...", [...], f() {...})
			array = expr.arguments[1];
			fn = expr.arguments[2];
			break;
		default: return;
		}
		if(array) {
			var param = this.evaluateExpression(array);
			var result = this.applyPluginsBailResult("call define:amd:array", expr, param);
			if(!result) return;
		}
		if(fn && fn.type === "FunctionExpression") {
			var inTry = this.scope.inTry;
			this.inScope(fn.params.filter(function(i) {
				return ["require", "module", "exports"].indexOf(i.name) < 0;
			}), function() {
				this.scope.inTry = inTry;
				if(fn.body.type === "BlockStatement")
					this.walkStatement(fn.body);
				else
					this.walkExpression(fn.body);
			}.bind(this));
		} else if(fn && isBoundFunctionExpression(fn)) {
			var inTry = this.scope.inTry;
			this.inScope(fn.callee.object.params.filter(function(i) {
				return ["require", "module", "exports"].indexOf(i.name) < 0;
			}), function() {
				this.scope.inTry = inTry;
				if(fn.callee.object.body.type === "BlockStatement")
					this.walkStatement(fn.callee.object.body);
				else
					this.walkExpression(fn.callee.object.body);
			}.bind(this));
			if(fn.arguments)
				this.walkExpressions(fn.arguments);
		} else if(fn || obj) {
			this.walkExpression(fn || obj);
		}
		var dep = new AMDDefineDependency(expr.range, array ? array.range : null, fn ? fn.range : null, obj ? obj.range : null);
		dep.loc = expr.loc;
		this.state.current.addDependency(dep);
		return true;
	},
	"call define:amd:array": function(expr, param) {
		if(param.isArray()) {
			param.items.forEach(function(param) {
				var result = this.applyPluginsBailResult("call define:amd:item", expr, param);
				if(result === undefined) {
					this.applyPluginsBailResult("call define:amd:context", expr, param);
				}
			}, this);
			return true;
		} else if(param.isConstArray()) {
			var deps = [];
			param.array.forEach(function(request) {
				var dep;
				if(["require", "exports", "module"].indexOf(request) >= 0) {
					dep = request;
				} else {
					dep = new AMDRequireItemDependency(request);
					dep.loc = expr.loc;
					dep.optional = !!this.scope.inTry;
					this.state.current.addDependency(dep);
				}
				deps.push(dep);
			}, this);
			var dep = new AMDRequireArrayDependency(deps, param.range);
			dep.loc = expr.loc;
			dep.optional = !!this.scope.inTry;
			this.state.current.addDependency(dep);
			return true;
		}
	},
	"call define:amd:item": function(expr, param) {
		if(param.isConditional()) {
			param.options.forEach(function(param) {
				var result = this.applyPluginsBailResult("call define:amd:item", expr, param);
				if(result === undefined) {
					this.applyPluginsBailResult("call define:amd:context", expr, param);
				}
			}, this);
			return true;
		} else if(param.isString()) {
			var dep;
			if(["require","exports","module"].indexOf(param.string) >= 0) {
				dep = new ConstDependency(param.string, param.range);
			} else {
				dep = new AMDRequireItemDependency(param.string, param.range);
			}
			dep.loc = expr.loc;
			dep.optional = !!this.scope.inTry;
			this.state.current.addDependency(dep);
			return true;
		}
	},
	"call define:amd:context": function(expr, param) {
		var dep = ContextDependencyHelpers.create(AMDRequireContextDependency, param.range, param, expr);
		if(!dep) return;
		dep.loc = expr.loc;
		dep.optional = !!this.scope.inTry;
		this.state.current.addDependency(dep);
		return true;
	}
});

