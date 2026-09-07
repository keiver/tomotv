import { licenseParagraphs } from "../licenseParagraphs";

describe("licenseParagraphs", () => {
  it("splits on blank lines and drops empties", () => {
    expect(licenseParagraphs("one\n\n   \n\ntwo\n")).toEqual(["one", "two"]);
  });

  it("unwraps a hard-wrapped, hang-indented paragraph into one line", () => {
    const apache =
      "   5. Submission of Contributions. Unless You explicitly state otherwise,\n      any Contribution intentionally submitted for inclusion in the Work\n      by You to the Licensor shall be under the terms and conditions of\n      this License, without any additional terms or conditions.";
    expect(licenseParagraphs(apache)).toEqual([
      "5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions.",
    ]);
  });

  it("keeps a heading's short lines and its ruler", () => {
    expect(licenseParagraphs("                 Apache License\n           Version 2.0, January 2004\n        http://www.apache.org/licenses/")).toEqual([
      "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/",
    ]);
    expect(licenseParagraphs("Mozilla Public License Version 2.0\n==================================")).toEqual(["Mozilla Public License Version 2.0\n=================================="]);
    expect(licenseParagraphs("GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999")).toEqual(["GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999"]);
  });

  it("keeps list items apart but unwraps the lines inside one", () => {
    const bsd =
      "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n* Redistributions of source code must retain the above copyright notice, this\n  list of conditions and the following disclaimer.\n* Redistributions in binary form must reproduce the above copyright notice.";
    expect(licenseParagraphs(bsd)).toEqual([
      "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n* Redistributions in binary form must reproduce the above copyright notice.",
    ]);
  });

  it("does not mistake a wrapped word or a section reference for a list marker", () => {
    expect(licenseParagraphs("or for a fee, you must give the recipients all the rights that we gave\nyou.  You must make sure that they, too, receive or can get the source")).toEqual([
      "or for a fee, you must give the recipients all the rights that we gave you.  You must make sure that they, too, receive or can get the source",
    ]);
    expect(licenseParagraphs("simply making modifications authorized by this Section 2(a)\n(4) never produces Adapted Material.")).toEqual([
      "simply making modifications authorized by this Section 2(a) (4) never produces Adapted Material.",
    ]);
  });

  it("keeps copyright lines, quoted lines and table rows on their own lines", () => {
    expect(licenseParagraphs("Copyright © 2010-2022  Google, Inc. and the other contributors listed\nCopyright © 2015-2020  Ebrahim Byagowi")).toEqual([
      "Copyright © 2010-2022  Google, Inc. and the other contributors listed\nCopyright © 2015-2020  Ebrahim Byagowi",
    ]);
    expect(licenseParagraphs("> Permission is hereby granted, free of charge, to any person obtaining a copy\n> of this software and associated documentation files")).toEqual([
      "> Permission is hereby granted, free of charge, to any person obtaining a copy\n> of this software and associated documentation files",
    ]);
    expect(licenseParagraphs("0.9.0 thru 1.2              1991-1995   CWI         yes\n1.3 thru 1.5.2  1.2         1995-1999   CNRI        yes")).toEqual([
      "0.9.0 thru 1.2              1991-1995   CWI         yes\n1.3 thru 1.5.2  1.2         1995-1999   CNRI        yes",
    ]);
  });

  it("unwraps a line that merely starts with the word copyright", () => {
    expect(
      licenseParagraphs("as you receive it, in any medium, provided that you conspicuously and appropriately publish on each copy an appropriate\ncopyright notice and disclaimer of warranty"),
    ).toEqual(["as you receive it, in any medium, provided that you conspicuously and appropriately publish on each copy an appropriate copyright notice and disclaimer of warranty"]);
  });
});
