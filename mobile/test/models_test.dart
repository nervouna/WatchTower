import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:watchtower/models.dart';

void main() {
  test('parses the checked-in complete brief contract fixture', () async {
    final source = await File(
      '../contracts/fixtures/brief-complete.json',
    ).readAsString();
    final brief = Brief.decode(source);
    expect(brief.date, '2026-07-17');
    expect(brief.status, 'complete');
    expect(brief.audio?.status, 'ready');
    expect(brief.audio?.cover?.status, 'ready');
    expect(brief.audio?.cover?.url, '/api/briefs/2026-07-17/cover');
    expect(brief.items.single.sources.single.source, 'github');
  });

  test('parses the checked-in archive contract fixture', () async {
    final source = await File(
      '../contracts/fixtures/brief-list.json',
    ).readAsString();
    final page = BriefListPage.fromJson(
      jsonDecode(source) as Map<String, dynamic>,
    );
    expect(page.briefs, hasLength(2));
    expect(page.briefs.last.missingSources, ['kickstarter']);
    expect(page.nextCursor, isNull);
  });

  test('ignores unknown fields but rejects invalid required fields', () {
    final valid =
        jsonDecode(
              File(
                '../contracts/fixtures/brief-complete.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    valid['futureField'] = {'safe': true};
    expect(Brief.fromJson(valid).headline, isNotEmpty);
    valid['status'] = 'draft';
    expect(() => Brief.fromJson(valid), throwsFormatException);
  });

  test('accepts older cached audio without a cover field', () {
    final valid =
        jsonDecode(
              File(
                '../contracts/fixtures/brief-complete.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    (valid['audio'] as Map<String, dynamic>).remove('cover');
    expect(Brief.fromJson(valid).audio?.cover, isNull);
  });
}
