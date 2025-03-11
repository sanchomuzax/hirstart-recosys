# hirstart-recosys
The extension's job is to recommend news based on reader behaviour on the hirstart.hu website.

![image](https://github.com/user-attachments/assets/031964a6-46fb-4e4e-ad26-b2781d707cf1)

The functionality is as follows:
- The extension monitors the domain name and news category of the news clicked by the reader on the hirstart.hu website.
- It continuously updates the reader's own top list, taking into account which domain news and which news topics the reader is reading.
- It only collects a sample on the hirstart.hu page of the extension, and only takes into account a maximum of about half a thousand click events.
- The extension selects relevant content from the news on the hirstart.hu page that is currently open. It recommends one of the top 5 news items from a top list based on weights. So it recommends different news on the home page and different news on a subpage.
- It skips news that has already been clicked once by the reader. Skip news pages that the reader has hidden with the "little eye". Also skip news that has been skip-checked by the reader using the "x" icon.
- If the recommendation does not appear, it is either because of the layout type or because there is no news to recommend based on previous clicks.
- Using the `?debug=recosys` URL parameter will display a mini information panel to help you understand how your own toplist works.

The extension can be downloaded and installed for your browser from here:
- Chrome Web Store: https://chromewebstore.google.com/detail/h%C3%ADrstart-recosys/gnbaopocbdfefeffpdacllibdgdbhcan
- Microsoft Edge Addons: https://microsoftedge.microsoft.com/addons/detail/h%C3%ADrstart-recosys/eojdenhakkeofbhhghdgangeknpmpoln
