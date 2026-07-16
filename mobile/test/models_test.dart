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
}
