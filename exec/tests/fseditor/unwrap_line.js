// Regression test for GitLab #1183 (fseditor.js unwrap_line TypeError).
//
// fseditor.js starts the editor at load time, so this extracts the real
// unwrap_line() / wrap_line() from the source and evals them with stubs.
//
// Proves:
//   - Pre-fix (guard stripped): TypeError when unkludge splices out the
//     last line and leftover space is still >= 1
//   - Post-fix (stock guard): no throw; lines join correctly
//   - Why "90-char word, delete down to 79" does not throw even unfixed
//
// Run via exec/tests/test.js (jsexec), or:
//   node exec/tests/fseditor/unwrap_line.js

"use strict";

var is_node = typeof process != "undefined"
	&& process.versions != undefined
	&& process.versions.node != undefined;

function say(msg)
{
	if (typeof print == "function")
		print(msg);
	else
		process.stdout.write(String(msg) + "\n");
}

function file_exists_portable(path)
{
	if (typeof file_exists == "function")
		return file_exists(path);
	return require("fs").existsSync(path);
}

function read_text(path)
{
	if (!is_node) {
		var f = new File(path);
		if (!f.open("r"))
			throw new Error("cannot open " + path);
		var t = f.read();
		f.close();
		return t;
	}
	return require("fs").readFileSync(path, "utf8");
}

function find_fseditor()
{
	var candidates = [];
	if (typeof system != "undefined" && system.exec_dir)
		candidates.push(system.exec_dir + "fseditor.js");
	if (typeof js != "undefined" && js.exec_dir)
		candidates.push(js.exec_dir + "../../fseditor.js");
	if (is_node)
		candidates.push(require("path").join(__dirname, "..", "..", "fseditor.js"));
	var i;
	for (i = 0; i < candidates.length; i++) {
		if (file_exists_portable(candidates[i]))
			return candidates[i];
	}
	throw new Error("cannot find fseditor.js (tried " + candidates.join(", ") + ")");
}

function extract_function(src, name, next_name)
{
	var needle = "function " + name + "(";
	var start = src.indexOf(needle);
	if (start < 0)
		throw new Error("function " + name + " not found in fseditor.js");
	var end = src.indexOf("\nfunction " + next_name + "(", start + 1);
	if (end < 0)
		throw new Error("function " + next_name + " not found after " + name);
	var body = src.substring(start, end);
	var last = body.lastIndexOf("}");
	if (last < 0)
		throw new Error("function " + name + " has no closing brace");
	return body.substring(0, last + 1);
}

var GUARD_RE = /\/\*\s*unkludge may have spliced out line\[l\+1\]\s*\*\/\s*if\(line\[l\+1\]==undefined\)\s*break;\s*/;

function strip_unkludge_guard(src)
{
	var stripped = src.replace(GUARD_RE, "");
	if (stripped == src)
		throw new Error("failed to strip the unkludge guard (pattern not found)");
	return stripped;
}

function repeat_ch(ch, n)
{
	var s = "";
	var i;
	for (i = 0; i < n; i++)
		s += ch;
	return s;
}

function Line(copyfrom)
{
	this.text = "";
	this.attr = "";
	this.hardcr = false;
	this.kludged = false;
	this.firstchar = 0;
	this.selected = false;
	if (copyfrom != undefined) {
		this.text = copyfrom.text;
		this.attr = copyfrom.attr;
		this.hardcr = copyfrom.hardcr;
		this.kludged = copyfrom.kludged;
		this.firstchar = copyfrom.firstchar;
		this.selected = copyfrom.selected;
	}
}

function make_line(text, opts)
{
	var ln = new Line();
	ln.text = text;
	ln.attr = repeat_ch("A", text.length);
	if (opts) {
		if (opts.kludged)
			ln.kludged = true;
		if (opts.hardcr)
			ln.hardcr = true;
	}
	return ln;
}

/* Stubs / globals the extracted wrap/unwrap functions close over. */
var line = [];
var console = { screen_columns: 80, screen_rows: 24 };
var topline = 0;
var lines_on_screen = 20;
function draw_line() {}
function alert(msg) { throw new Error("alert: " + msg); }
function exit() { throw new Error("exit() called"); }

var src = read_text(find_fseditor());
var unwrap_src = extract_function(src, "unwrap_line", "wrap_line");
var wrap_src = extract_function(src, "wrap_line", "rewrap");

if (!GUARD_RE.test(unwrap_src))
	throw new Error("unwrap_line() is missing the post-unkludge guard from GitLab #1183");

var unwrap_line_fixed = eval("(" + unwrap_src + ")");
var unwrap_line_broken = eval("(" + strip_unkludge_guard(unwrap_src) + ")");
var wrap_line = eval("(" + wrap_src + ")");

function joined_text()
{
	var s = "";
	var i;
	for (i = 0; i < line.length; i++)
		s += line[i].text;
	return s;
}

function expect_throw(fn, what)
{
	var threw = false;
	var err;
	try {
		fn();
	}
	catch (e) {
		threw = true;
		err = e;
	}
	if (!threw)
		throw new Error(what + ": expected TypeError, nothing thrown");
	var msg = String(err);
	if (msg.indexOf("undefined") < 0)
		throw new Error(what + ": expected TypeError reading undefined, got " + msg);
	say("  threw as expected: " + msg);
}

function expect_equal(got, want, what)
{
	if (got !== want)
		throw new Error(what + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

/*
 * The #1183 crash: kludged line[l], last line fully consumed by unkludge,
 * leftover space still >= 1 (combined length < screen_columns-1).
 * 70 + 5 = 75 < 79.
 */
function setup_crash_case()
{
	line = [
		make_line(repeat_ch("W", 70), { kludged: true }),
		make_line(repeat_ch("W", 5), { hardcr: true })
	];
}

say("GitLab #1183 unwrap_line harness");
say("");

say("1. Pre-fix (guard stripped): last-line unkludge splice must TypeError");
setup_crash_case();
expect_throw(function () { unwrap_line_broken(0); }, "pre-fix crash case");

say("2. Post-fix: same state joins and does not throw");
setup_crash_case();
unwrap_line_fixed(0);
expect_equal(line.length, 1, "post-fix line count");
expect_equal(line[0].text, repeat_ch("W", 75), "post-fix joined text");
expect_equal(line[0].kludged, false, "post-fix kludged cleared");
expect_equal(line[0].hardcr, true, "post-fix inherited hardcr");
say("  joined 70+5 into one 75-char line, hardcr inherited");

/*
 * CTRL-W on the first line of a 90-char kludge wrap empties that line
 * without calling rewrap(). The next unwrap is the realistic editor path.
 */
say("3. Realistic path: CTRL-W on first line of a 90-char kludge wrap");
line = [make_line(repeat_ch("W", 90))];
wrap_line(0);
expect_equal(line.length, 2, "wrap of 90-char word");
expect_equal(line[0].text.length, 79, "kludge wrap first line");
expect_equal(line[0].kludged, true, "first line marked kludged");
expect_equal(line[1].text.length, 11, "kludge wrap remainder");
/* CTRL-W deletes the whole word on the current line and does not rewrap. */
line = [make_line("", { kludged: true }), make_line(repeat_ch("W", 11))];
expect_throw(function () { unwrap_line_broken(0); }, "pre-fix CTRL-W then unwrap");
line = [make_line("", { kludged: true }), make_line(repeat_ch("W", 11))];
unwrap_line_fixed(0);
expect_equal(line.length, 1, "CTRL-W path line count");
expect_equal(line[0].text, repeat_ch("W", 11), "CTRL-W path joined remainder");
say("  CTRL-W + next rewrap: TypeError without guard, 11-char line with guard");

/*
 * Deuce's interactive try: 90-char word, single-char deletes down to 79.
 * Leftover space after each unkludge is 0, so line[l+1].text is never
 * read after a last-line splice — even without the guard.
 */
function delete_one_from_end()
{
	var last = line.length - 1;
	if (line[last].text.length == 0) {
		if (last == 0)
			return;
		line.pop();
		last--;
	}
	line[last].text = line[last].text.substr(0, line[last].text.length - 1);
	line[last].attr = line[last].attr.substr(0, line[last].text.length);
}

function delete_one_from_first()
{
	if (line[0].text.length == 0)
		return;
	line[0].text = line[0].text.substr(0, line[0].text.length - 1);
	line[0].attr = line[0].attr.substr(0, line[0].text.length);
}

say("4. Deuce path A: 90-char word, delete from the end down to 79 (unfixed)");
line = [make_line(repeat_ch("W", 90))];
wrap_line(0);
var n;
for (n = 0; n < 11; n++) {
	delete_one_from_end();
	unwrap_line_broken(0);
}
expect_equal(joined_text().length, 79, "delete-from-end total length");
say("  no throw; total length 79 (first line stayed full-width, space was 0)");

say("5. Deuce path B: 90-char word, delete from first line down to 79 (unfixed)");
line = [make_line(repeat_ch("W", 90))];
wrap_line(0);
for (n = 0; n < 11; n++) {
	delete_one_from_first();
	unwrap_line_broken(0);
}
expect_equal(joined_text().length, 79, "delete-from-first total length");
expect_equal(line.length, 1, "delete-from-first collapsed to one line");
say("  no throw; each 1-column hole was filled exactly (leftover space 0)");

say("6. Mid-buffer splice (not last line) still unwraps the following line");
line = [
	make_line(repeat_ch("W", 70), { kludged: true }),
	make_line(repeat_ch("W", 5)),
	make_line(" next", { hardcr: true })
];
unwrap_line_fixed(0);
if (joined_text().indexOf("WWWWW next") < 0 && joined_text().indexOf("next") < 0)
	throw new Error("mid-buffer unwrap lost following text: " + JSON.stringify(joined_text()));
if (line.length < 1)
	throw new Error("mid-buffer unwrap deleted everything");
say("  following line survived/joined; " + line.length + " line(s) remain");

say("7. Hard CR on the kludged line stops without touching the next line");
line = [
	make_line(repeat_ch("W", 70), { kludged: true, hardcr: true }),
	make_line(repeat_ch("W", 5))
];
unwrap_line_fixed(0);
expect_equal(line.length, 2, "hardcr leaves two lines");
expect_equal(line[0].text.length, 70, "hardcr did not unkludge");
say("  hardcr honored");

say("");
say("All unwrap_line #1183 checks passed.");
